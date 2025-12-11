const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const port = process.env.port || 3000;
const crypto = require("crypto");

const admin = require("firebase-admin");

const serviceAccount = require("./home-decoration-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

function generateTrackingId() {
  const prefix = "PRCL"; // your brand prefix
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6-char random hex

  return `${prefix}-${date}-${random}`;
}

// middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    res.status(401).send({ message: "unauthorized access" });
  }
};

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
    const usersCollection = db.collection("users");
    // const usersCollection = client.db("home_decor_db").collection("users");
    const decorationsCollection = db.collection("decorations");
    const paymentsCollection = db.collection("payments");
    const decoratorsCollection = db.collection("decorators");

    // user related api
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await usersCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "user exists" });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

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

      res.send({ url: session.url });
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
          decorationName: paymentInfo.serviceName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      console.log(session);
      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // 1. Get the Stripe Transaction ID
        const transactionId = session.payment_intent;

        // 2. CHECK DUPLICATION: Use transactionId (Stripe's ID) to check if payment exists
        // (Checking trackingId here is wrong because it's a new random string)
        const query = { transactionId: transactionId };
        const paymentExist = await paymentsCollection.findOne(query);
        console.log(paymentExist);
        if (paymentExist) {
          return res.send({
            message: "already exists",
            transactionId,
            trackingId: paymentExist.trackingId,
          });
        }

        // 3. Generate the custom Tracking ID only if it's a new payment
        const trackingId = generateTrackingId();

        if (session.payment_status === "paid") {
          const id = session.metadata.decorationId;
          const queryDecoration = { _id: new ObjectId(id) };

          // Update decoration status
          const update = {
            $set: {
              paymentStatus: "paid",
              trackingId: trackingId,
            },
          };
          const result = await decorationsCollection.updateOne(
            queryDecoration,
            update
          );

          // Create Payment Record
          const payment = {
            amount: session.amount_total / 100,
            currency: session.currency,
            customerEmail: session.customer_details.email,
            decorationId: session.metadata.decorationId,
            decorationName: session.metadata.decorationName,
            transactionId: session.payment_intent,
            paymentStatus: session.payment_status,
            trackingId: trackingId,
            paidAt: new Date(),
          };

          const resultPayment = await paymentsCollection.insertOne(payment);

          return res.send({
            success: true,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            modifyDecoration: result,
            paymentInfo: resultPayment,
          });
        }

        return res.send({ success: false });
      } catch (error) {
        console.error(error);
        return res.status(500).send({ success: false, error: error.message });
      }
    });

    // payment related apis
    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};

      // console.log('headers', req.headers);

      if (email) {
        query.customerEmail = email;

        // check email address
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "forbidden access" });
        }
      }
      const cursor = paymentsCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    // decorator related apis
    app.get("/decorators", async (req, res) => {
      const query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = decoratorsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/decorators", async (req, res) => {
      const decorator = req.body;
      decorator.status = "pending";
      decorator.createdAt = new Date();

      const result = await decoratorsCollection.insertOne(decorator);
      res.send(result);
    });

    app.patch("/decorators/:id", verifyFBToken, async (req, res) => {
      const {status, email} = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: status ,
        },
      };

      const result = await decoratorsCollection.updateOne(query, updatedDoc);

      if(status === 'approved' && email){
        const email = req.body.email;
        const userQuery = {email: email};
        const updateUser = {
          $set: {
            role: 'decorator'
          }
        }
        const userResult = await usersCollection.updateOne(userQuery, updateUser)
      }


      res.send(result);
    });

    app.delete("/decorators/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await decoratorsCollection.deleteOne(query);
      res.send(result);
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
