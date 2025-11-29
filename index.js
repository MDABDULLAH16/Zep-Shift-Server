const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const stripe = require("stripe")(process.env.STRIPE_SECRET, {
  apiVersion: "2025-11-17.clover",
});

const MY_DOMAIN = process.env.PAYMENT_DOMAIN;
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
const uri = process.env.MONGO_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
function generateTrackingId() {
  const prefix = "ZEP";

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD

  const random = Math.random().toString(36).substring(2, 8).toUpperCase(); // 6 chars

  return `${prefix}-${date}-${random}`;
}
app.get("/", (req, res) => {
  res.send("Welcome to Zep-Shift!");
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    //collection;
    const zepShiftDB = client.db("ZepShit");
    const userCollection = zepShiftDB.collection("users");
    const parcelCollection = zepShiftDB.collection("parcels");
    const paymentCollection = zepShiftDB.collection("payments");

    app.post("/users", async (req, res) => {
      const newUser = req.body;
      const query = { email: newUser.email };
      const existUser = await userCollection.findOne(query);
      if (existUser) {
        return res.send({ message: "user already Exist" });
      }
      const result = await userCollection.insertOne(newUser);
      res.send(result);
    });

    //parcels api
    app.post("/parcels", async (req, res) => {
      const newParcel = { ...req.body, createdAt: new Date() };
      const result = await parcelCollection.insertOne(newParcel);
      res.send(result);
    });
    app.get("/parcels", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.senderEmail = email;
      }
      const options = { sort: { createdAt: -1 } };
      const cursor = parcelCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });
    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const cursor = await parcelCollection.findOne(query);

      res.send(cursor);
    });
    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const cursor = await parcelCollection.deleteOne(query);
      res.send(cursor);
    });
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const { parcelId, price, email, parcelName } = req.body;

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          customer_email: email,
          metadata: {
            parcelId,
            parcelName,
          },
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: parcelName,
                },
                unit_amount: price * 100, // amount in cents
              },
              quantity: 1,
            },
          ],

          success_url: `${MY_DOMAIN}/dashboard/paymentSuccess?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${MY_DOMAIN}/dashboard/paymentCancelled`,
        });

        res.send({ url: session.url });
      } catch (error) {
        console.log(error);
        res.status(500).json({ error: error.message });
      }
    });
    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const trackingId = generateTrackingId();
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const existPayment = await paymentCollection.findOne(query);
      if (existPayment) {
        return res.send({
          message: "payment already done!",
          transactionId,
          trackingId: existPayment.trackingId,
        });
      }
      if (session.payment_status === "paid") {
        const pId = session.metadata.parcelId;
        const query = { _id: new ObjectId(pId) };
        const update = {
          $set: {
            paymentStatus: "paid",
            trackingId: trackingId,
          },
        };
        const result = await parcelCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,
        };
        if (session.payment_status === "paid") {
          const paymentResult = await paymentCollection.insertOne(payment);
          res.send({
            success: true,
            paymentInfo: paymentResult,
            trackingId,
            modifyParcels: result,
            transactionId: session.payment_intent,
          });
        }
      }
    });
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Zep-Shift listening on port ${port}`);
});
