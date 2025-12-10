const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const port = process.env.port || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@first-backend.5ob3yor.mongodb.net/?appName=first-backend`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("home_decor_db");
    const decorationsCollection = db.collection("decorations");

    // decoration api

    app.get("/decorations", async (req, res) => {
      const query = {};

      const { email } = req.query;
      if (email) {
        query.adminEmail = email;
      }

      const options = { sort: { createdAt: -1 } };

      const cursor = decorationsCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/decorations/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await decorationsCollection.findOne(query);
      res.send(result);
    });

    app.post("/decorations", async (req, res) => {
      const decoration = req.body;

      // Decoration Created time
      decoration.createdAt = new Date();

      const result = await decorationsCollection.insertOne(decoration);
      res.send(result);
    });

    app.delete("/decorations/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await decorationsCollection.deleteOne(query);
      res.send(result);
    });

    // payment related apis
    app.post("/payment-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "BDT",
              unit_amount: amount,
              product_data: {
                name: `Please pay for: ${paymentInfo.serviceName}`,
              },
            },

            quantity: 1,
          },
        ],
        mode: "payment",
        customer_email: paymentInfo.adminEmail,
        metadata: {
          decorationId: paymentInfo.decorationId,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      res.send({ url: session.url })
    });

    // old
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: "BDT",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.serviceName,
              },
            },

            quantity: 1,
          },
        ],
        customer_email: paymentInfo.adminEmail,
        mode: "payment",
        metadata: {
          decorationId: paymentInfo.decorationId,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      console.log(session);
      res.send({ url: session.url });
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

app.get("/", (req, res) => {
  res.send("Home is Decorating");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
