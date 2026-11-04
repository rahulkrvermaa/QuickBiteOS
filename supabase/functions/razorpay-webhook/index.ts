// Supabase Edge Function: razorpay-webhook
// Secure, idempotent webhook ingestion handler

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const signature = req.headers.get('x-razorpay-signature')
    const rawBody = await req.text()

    const cleanSecret = (val?: string): string => val?.trim().replace(/^["']|["']$/g, '') ?? ''
    const webhookSecret = cleanSecret(Deno.env.get('RAZORPAY_WEBHOOK_SECRET'))

    if (!signature || !webhookSecret) {
      return new Response('Missing signature or server RAZORPAY_WEBHOOK_SECRET', { status: 400 })
    }

    // 1. Verify Webhook Signature
    const keyData = new TextEncoder().encode(webhookSecret)
    const messageData = new TextEncoder().encode(rawBody)
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

    // Timing-safe comparison
    const isSignatureValid = (a: string, b: string): boolean => {
      if (a.length !== b.length) return false
      let mismatch = 0
      for (let i = 0; i < a.length; i++) {
        mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
      }
      return mismatch === 0
    }

    if (!isSignatureValid(expectedSignature, signature)) {
      console.error('Webhook signature mismatch')
      return new Response('Invalid Signature', { status: 400 })
    }

    const event = JSON.parse(rawBody)
    const eventId = event.event_id || event.id

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 2. Strict Idempotency Check: Insert event into payment_webhook_events
    const { error: insertErr } = await supabaseAdmin.from('payment_webhook_events').insert({
      id: eventId,
      event_type: event.event,
      payload: event,
    })

    if (insertErr && insertErr.code === '23505') {
      // 23505 = unique_violation: already processed this webhook event
      console.log(`Duplicate webhook event ${eventId} received. Acknowledging idempotently.`)
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 3. Process event types
    if (event.event === 'payment.captured') {
      const payment = event.payload.payment.entity
      const orderId = payment.notes?.quickbite_order_id

      if (orderId) {
        // Fetch order to verify amount, currency, and not already paid
        const { data: order } = await supabaseAdmin
          .from('orders')
          .select('id, business_id, branch_id, payment_status, total_paisa')
          .eq('id', orderId)
          .single()

        // Amount & currency server-side validation
        if (order && payment.currency === 'INR' && Number(payment.amount) === Number(order.total_paisa)) {
          if (order.payment_status !== 'PAID') {
            // Check if token was already allocated by verify-razorpay-payment
            const { data: existingToken } = await supabaseAdmin
              .from('pickup_tokens')
              .select('id')
              .eq('order_id', order.id)
              .single()

            if (!existingToken) {
              // Allocate atomic token
              await supabaseAdmin.rpc('allocate_pickup_token', {
                p_order_id: order.id,
                p_business_id: order.business_id,
                p_branch_id: order.branch_id,
                p_prefix: 'A',
              })
            }

            // Mark paid
            await supabaseAdmin
              .from('orders')
              .update({
                status: 'PLACED',
                payment_status: 'PAID',
                updated_at: new Date().toISOString(),
              })
              .eq('id', order.id)

            // Update payment_orders & record payment transaction
            if (payment.order_id) {
              const { data: payOrder } = await supabaseAdmin
                .from('payment_orders')
                .update({ status: 'paid' })
                .eq('provider_order_id', payment.order_id)
                .select('id')
                .maybeSingle()

              if (payOrder && payment.id) {
                await supabaseAdmin.from('payment_transactions').upsert(
                  {
                    payment_order_id: payOrder.id,
                    provider_payment_id: payment.id,
                    provider_signature: signature || 'webhook_verified',
                    status: 'captured',
                    captured_at: new Date().toISOString(),
                  },
                  { onConflict: 'provider_payment_id', ignoreDuplicates: true }
                )
              }
            }
          }
        } else {
          console.error(`Webhook amount/currency mismatch for order ${orderId}: expected ${order?.total_paisa} INR, received ${payment.amount} ${payment.currency}`)
          return new Response(JSON.stringify({ error: 'Amount or currency mismatch: payment rejected' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }
    } else if (event.event === 'refund.processed') {
      const payment = event.payload.payment.entity
      const orderId = payment?.notes?.quickbite_order_id

      if (orderId) {
        await supabaseAdmin
          .from('orders')
          .update({
            payment_status: 'REFUNDED',
            status: 'REFUNDED',
            updated_at: new Date().toISOString(),
          })
          .eq('id', orderId)
      }
    }

    return new Response(JSON.stringify({ received: true, event: event.event }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('Webhook error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
