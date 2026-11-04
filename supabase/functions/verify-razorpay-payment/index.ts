// Supabase Edge Function: verify-razorpay-payment
// Cryptographic verification & Atomic Token Allocation on the server

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { orderId, secureAccessToken, razorpayOrderId, razorpayPaymentId, razorpaySignature } = await req.json()

    if (!orderId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return new Response(JSON.stringify({ error: 'Missing payment signature parameters' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const cleanSecret = (val?: string): string => val?.trim().replace(/^["']|["']$/g, '') ?? ''

    const razorpayKeyId = cleanSecret(Deno.env.get('RAZORPAY_KEY_ID'))
    const razorpayKeySecret = cleanSecret(Deno.env.get('RAZORPAY_KEY_SECRET'))

    if (!razorpayKeyId || !razorpayKeySecret || razorpayKeySecret === razorpayKeyId) {
      return new Response(JSON.stringify({ error: 'Razorpay credentials (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET) not configured or invalid on server' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1. Compute expected HMAC SHA-256 signature
    const payload = `${razorpayOrderId}|${razorpayPaymentId}`
    const keyData = new TextEncoder().encode(razorpayKeySecret)
    const messageData = new TextEncoder().encode(payload)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    // 2. Timing-safe verification
    const isSignatureValid = (a: string, b: string): boolean => {
      if (a.length !== b.length) return false
      let mismatch = 0
      for (let i = 0; i < a.length; i++) {
        mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
      }
      return mismatch === 0
    }

    if (!isSignatureValid(expectedSignature, razorpaySignature)) {
      return new Response(JSON.stringify({ error: 'Invalid payment signature. Verification failed.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 3. Fetch order from authoritative database
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .select('id, business_id, branch_id, status, payment_status, total_paisa, secure_access_token')
      .eq('id', orderId)
      .single()

    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3b. Guest order token validation if provided
    if (secureAccessToken && order.secure_access_token) {
      if (!isSignatureValid(order.secure_access_token, secureAccessToken)) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Invalid order access token' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // 4. Validate payment order linkage (prevents order tampering / cross-order replay)
    const { data: payOrder, error: payOrderErr } = await supabaseAdmin
      .from('payment_orders')
      .select('id, amount_paisa, currency, status')
      .eq('provider_order_id', razorpayOrderId)
      .eq('order_id', order.id)
      .single()

    if (payOrderErr || !payOrder) {
      return new Response(
        JSON.stringify({ error: 'Razorpay order does not match this order' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 4b. Explicit amount & currency verification
    if (Number(payOrder.amount_paisa) !== Number(order.total_paisa)) {
      return new Response(
        JSON.stringify({
          error: `Payment verification failed: Amount mismatch. Expected ${order.total_paisa} paisa, recorded ${payOrder.amount_paisa} paisa`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (payOrder.currency !== 'INR') {
      return new Response(
        JSON.stringify({
          error: `Payment verification failed: Unsupported currency ${payOrder.currency}. Expected INR`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 5. Idempotency Check: if order is already PAID, return existing token without reallocating
    if (order.payment_status === 'PAID') {
      const { data: existingToken } = await supabaseAdmin
        .from('pickup_tokens')
        .select('token_display, sequence_num')
        .eq('order_id', order.id)
        .single()

      return new Response(
        JSON.stringify({
          verified: true,
          orderId: order.id,
          status: order.status,
          paymentStatus: 'PAID',
          tokenDisplay: existingToken?.token_display,
          sequenceNum: existingToken?.sequence_num,
          idempotent: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 6. Ensure order is in valid pending state
    if (order.status !== 'PENDING_PAYMENT') {
      return new Response(
        JSON.stringify({ error: `Cannot verify payment for order with status: ${order.status}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 7. Atomically allocate pickup token via PostgreSQL function
    const { data: tokenData, error: tokenErr } = await supabaseAdmin.rpc('allocate_pickup_token', {
      p_order_id: order.id,
      p_business_id: order.business_id,
      p_branch_id: order.branch_id,
      p_prefix: 'A',
    })

    if (tokenErr) {
      return new Response(JSON.stringify({ error: 'Token allocation error: ' + tokenErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 8. Update order to PLACED / PAID
    await supabaseAdmin
      .from('orders')
      .update({
        status: 'PLACED',
        payment_status: 'PAID',
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id)

    // 9. Update payment_orders status to paid
    await supabaseAdmin
      .from('payment_orders')
      .update({ status: 'paid' })
      .eq('id', payOrder.id)

    // 10. Record payment transaction idempotently
    await supabaseAdmin.from('payment_transactions').upsert(
      {
        payment_order_id: payOrder.id,
        provider_payment_id: razorpayPaymentId,
        provider_signature: razorpaySignature,
        status: 'captured',
        captured_at: new Date().toISOString(),
      },
      { onConflict: 'provider_payment_id', ignoreDuplicates: true }
    )

    const token = Array.isArray(tokenData) ? tokenData[0] : tokenData

    return new Response(
      JSON.stringify({
        verified: true,
        orderId: order.id,
        status: 'PLACED',
        paymentStatus: 'PAID',
        tokenDisplay: token?.token_display,
        sequenceNum: token?.sequence_num,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

