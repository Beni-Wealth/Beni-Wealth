const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/**
 * claimReward
 * - Credits ₦0.20 directly to user balance
 * - Enforces 1-hour cooldown
 * - Logs transaction in Firestore
 */
exports.claimReward = functions.region("us-central1").https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "User must be logged in"
      );
    }

    const uid = context.auth.uid;
    const CLAIM_AMOUNT = 0.2;
    const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

    const userRef = db.collection("users").doc(uid);
    const txRef = db.collection("ptc_transactions").doc();

    try {
      await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);

        const now = Date.now();
        let balance = 0;
        let lastClaim = 0;

        if (userSnap.exists) {
          const data = userSnap.data();
          balance = Number(data.balance || 0);
          lastClaim = Number(data.lastPtcClaim || 0);
        }

        if (now - lastClaim < COOLDOWN_MS) {
          throw new functions.https.HttpsError(
            "resource-exhausted",
            "You can only claim once every hour"
          );
        }

        const newBalance = balance + CLAIM_AMOUNT;

        // Update user balance
        tx.set(
          userRef,
          {
            balance: newBalance,
            lastPtcClaim: now,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        // Log transaction
        tx.set(txRef, {
          uid,
          amount: CLAIM_AMOUNT,
          type: "ptc",
          articleUrl: data?.articleUrl || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      // Re-fetch updated balance
      const updatedUser = await userRef.get();

      return {
        success: true,
        message: "₦0.20 credited successfully",
        newBalance: updatedUser.data().balance,
      };
    } catch (err) {
      if (err instanceof functions.https.HttpsError) {
        throw err;
      }

      console.error("claimReward error:", err);
      throw new functions.https.HttpsError(
        "internal",
        "Unable to process claim right now"
      );
    }
  }
);
