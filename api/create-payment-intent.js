const Stripe = require("stripe");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const CONFIG = require("../config");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function generateActivationCode(length) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < length; i++) {
    const index = crypto.randomInt(0, chars.length);
    code += chars[index];
  }

  return code;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { phone } = req.body || {};

    if (!phone) {
      return res.status(400).json({
        error: "Phone number is required"
      });
    }

    const activationCode = generateActivationCode(
      CONFIG.activationCodeLength
    );

    const expiresAt = new Date(
      Date.now() + CONFIG.activationCodeValidityHours * 60 * 60 * 1000
    ).toISOString();

    // 1. Vytvoření aktivačního kódu
    const { data: userKey, error: keyError } = await supabase
      .from("user_keys")
      .insert({
        key_code: activationCode,
        phone_number: phone,
        status: "active",
        payment_status: "pending",
        deposit_status: "pending",
        expires_at: expiresAt
      })
      .select()
      .single();

    if (keyError) {
      console.error("Supabase user_keys error:", keyError);

      return res.status(500).json({
        error: "Failed to create activation code"
      });
    }

    // 2. Stripe Customer
    const customer = await stripe.customers.create({
      phone: phone,
      metadata: {
        user_key_id: String(userKey.id)
      }
    });

    // 3. Platba 200 Kč
    const rentalPaymentIntent = await stripe.paymentIntents.create({
      amount: CONFIG.activationCodePrice * 100,
      currency: CONFIG.currency,
      customer: customer.id,
      payment_method_types: ["card"],
      capture_method: "automatic",
      metadata: {
        type: "activation_code_purchase",
        user_key_id: String(userKey.id)
      }
    });

    // 4. Autorizace zálohy 400 Kč
    const depositPaymentIntent = await stripe.paymentIntents.create({
      amount: CONFIG.depositAmount * 100,
      currency: CONFIG.currency,
      customer: customer.id,
      payment_method_types: ["card"],
      capture_method: "manual",
      metadata: {
        type: "powerbank_deposit",
        user_key_id: String(userKey.id)
      }
    });

    // 5. Uložení Stripe ID do databáze
    const { error: updateError } = await supabase
      .from("user_keys")
      .update({
        stripe_customer_id: customer.id,
        stripe_rental_payment_intent: rentalPaymentIntent.id,
        stripe_deposit_payment_intent: depositPaymentIntent.id
      })
      .eq("id", userKey.id);

    if (updateError) {
      console.error("Supabase update error:", updateError);

      return res.status(500).json({
        error: "Failed to save payment information"
      });
    }

    return res.status(200).json({
      userKeyId: userKey.id,
      rentalPaymentClientSecret: rentalPaymentIntent.client_secret,
      depositPaymentClientSecret: depositPaymentIntent.client_secret
    });

  } catch (error) {
    console.error("Create payment intent error:", error);

    return res.status(500).json({
      error: "Internal server error"
    });
  }
};