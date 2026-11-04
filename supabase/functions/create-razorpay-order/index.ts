// Supabase Edge Function: create-razorpay-order
// Runs securely on Deno / Supabase Edge Functions. Secrets never leak to browser.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { orderId, secureAccessToken } = await req.json()
    if (!orderId || !secureAccessToken) {
      return new Response(JSON.stringify({ error: 'orderId and secureAccessToken are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const cleanSecret = (val?: string): string => val?.trim().replace(/^["']|["']$/g, '') ?? ''

    const razorpayKeyId = cleanSecret(Deno.env.get('RAZORPAY_KEY_ID'))
    const razorpayKeySecret = cleanSecret(Deno.env.get('RAZORPAY_KEY_SECRET'))

    if (!razorpayKeyId || !razorpayKeySecret || razorpayKeySecret === razorpayKeyId) {
      return new Response(
        JSON.stringify({ error: 'Razorpay credentials (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET) not configured or invalid on server' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Fetch order from authoritative database
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .select('id, total_paisa, order_number, status, payment_status, secure_access_token')
      .eq('id', orderId)
      .single()

    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1a. Timing-safe verification of customer order access token
    const isTokenValid = (a: string, b: string): boolean => {
      if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
      let mismatch = 0
      for (let i = 0; i < a.length; i++) {
        mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
      }
      return mismatch === 0
    }

    if (!isTokenValid(order.secure_access_token, secureAccessToken)) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid order access token' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1b. Server-side validation: Order must be PENDING_PAYMENT and UNPAID
    if (order.status !== 'PENDING_PAYMENT' || order.payment_status !== 'UNPAID') {
      return new Response(
        JSON.stringify({
          error: `Order cannot be paid. Current status: ${order.status}, payment: ${order.payment_status}`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!order.total_paisa || order.total_paisa <= 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid order amount' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 1c. Fast path: check if a valid created Razorpay order already exists for this order
    const { data: existingPayOrder } = await supabaseAdmin
      .from('payment_orders')
      .select('provider_order_id, amount_paisa')
      .eq('order_id', order.id)
      .eq('status', 'created')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (
      existingPayOrder?.provider_order_id &&
      Number(existingPayOrder.amount_paisa) === Number(order.total_paisa)
    ) {
      return new Response(
        JSON.stringify({
          razorpayOrderId: existingPayOrder.provider_order_id,
          amountPaisa: order.total_paisa,
          currency: 'INR',
          keyId: razorpayKeyId,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Call Razorpay API to create trusted order
    const authHeader = 'Basic ' + btoa(`${razorpayKeyId}:${razorpayKeySecret}`)
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: order.total_paisa, // In Integer Paisa
        currency: 'INR',
        receipt: order.order_number,
        notes: {
          quickbite_order_id: order.id,
        },
      }),
    })

    const rzpOrder = await rzpRes.json()

    if (!rzpRes.ok) {
      return new Response(JSON.stringify({ error: rzpOrder.error?.description || 'Razorpay order failed' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Record into payment_orders
    await supabaseAdmin.from('payment_orders').insert({
      order_id: order.id,
      provider: 'razorpay',
      provider_order_id: rzpOrder.id,
      amount_paisa: order.total_paisa,
      currency: 'INR',
      status: 'created',
    })

    return new Response(
      JSON.stringify({
        razorpayOrderId: rzpOrder.id,
        amountPaisa: order.total_paisa,
        currency: 'INR',
        keyId: razorpayKeyId,
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

