const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      userKeyId,
      rentalPaymentIntentId,
      depositPaymentIntentId
    } = req.body || {};

    if (
      !userKeyId ||
      !rentalPaymentIntentId ||
      !depositPaymentIntentId
    ) {
      return res.status(400).json({
        error: "Missing payment information"
      });
    }

    // Načteme aktivační kód
    const { data: userKey, error: keyError } = await supabase
      .from("user_keys")
      .select("*")
      .eq("id", userKeyId)
      .single();

    if (keyError || !userKey) {
      return res.status(404).json({
        error: "Activation code not found"
      });
    }

    // Ověříme 200 Kč platbu přímo u Stripe
    const rentalPaymentIntent =
      await stripe.paymentIntents.retrieve(
        rentalPaymentIntentId
      );

    if (
      rentalPaymentIntent.status !== "succeeded"
    ) {
      return res.status(400).json({
        error: "Rental payment was not successful"
      });
    }

    // Ověříme autorizaci zálohy
    const depositPaymentIntent =
      await stripe.paymentIntents.retrieve(
        depositPaymentIntentId
      );

    if (
      depositPaymentIntent.status !== "requires_capture"
    ) {
      return res.status(400).json({
        error: "Deposit was not authorized"
      });
    }

    // Ověříme, že PaymentIntenty patří k tomuto aktivačnímu kódu
    if (
      rentalPaymentIntent.metadata.user_key_id !==
      String(userKeyId)
    ) {
      return res.status(400).json({
        error: "Invalid rental payment"
      });
    }

    if (
      depositPaymentIntent.metadata.user_key_id !==
      String(userKeyId)
    ) {
      return res.status(400).json({
        error: "Invalid deposit payment"
      });
    }

    // Označíme aktivační kód jako zaplacený
    const { error: updateError } = await supabase
      .from("user_keys")
      .update({
        stripe_rental_payment_intent:
          rentalPaymentIntent.id,

        stripe_deposit_payment_intent:
          depositPaymentIntent.id,

        payment_status: "paid",

        deposit_status: "authorized"
      })
      .eq("id", userKeyId);

    if (updateError) {
      console.error("Supabase update error:", updateError);

      return res.status(500).json({
        error: "Failed to update activation code"
      });
    }

    return res.status(200).json({
      success: true,
      activationCode: userKey.key_code
    });

  } catch (error) {
    console.error("Complete payment error:", error);

    return res.status(500).json({
      error: "Internal server error"
    });
  }
};