const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const port = process.env.port || 3000;
const crypto = require("crypto");

const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { access } = require("fs");

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
    // await client.connect();

    const db = client.db("home_decor_db");
    const usersCollection = db.collection("users");
    const decorationsCollection = db.collection("decorations");
    const paymentsCollection = db.collection("payments");
    const decoratorsCollection = db.collection("decorators");
    const bookingsCollection = db.collection("bookings");

    // middleware verify admin before allowing admin activity
    // must be used after verifyFBToken middleware

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    const verifyDecorator = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "decorator") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    app.get("/analytics", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const serviceStats = await decorationsCollection
          .aggregate([
            {
              $group: {
                _id: "$serviceName",
                count: { $sum: 1 },
                totalRevenue: { $sum: { $toInt: "$cost" } },
              },
            },
            {
              $project: {
                _id: 0,
                name: "$_id",
                bookings: "$count",
                revenue: "$totalRevenue",
              },
            },
          ])
          .toArray();

        const totalRevenue = serviceStats.reduce(
          (sum, item) => sum + item.revenue,
          0
        );
        const totalBookings = serviceStats.reduce(
          (sum, item) => sum + item.bookings,
          0
        );

        res.send({
          serviceStats,
          totalRevenue,
          totalBookings,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Error fetching analytics" });
      }
    });

    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const result = await bookingsCollection.insertOne(booking); // Ensure you define bookingsCollection
      res.send(result);
    });

    // const logTracking = async(trackingId, status) => {
    //   const log = {
    //     trackingId,
    //     status,
    //     details: status,
    //     createdAt: new Date().toLocaleString()
    //   }
    //   const result = await trackingsCollection.insertOne(log);
    //   return result;
    // }

    // user related api

    app.get("/users", verifyFBToken, async (req, res) => {
      const cursor = usersCollection.find().sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

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

    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const roleInfo = req.body;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: roleInfo.role,
          },
        };
        const result = await usersCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );

    // decoration api
    app.get("/decorations", async (req, res) => {
      const query = {};

      const { email, decorationStatus } = req.query;
      if (email) {
        query.adminEmail = email;
      }

      if (decorationStatus) {
        query.decorationStatus = decorationStatus;
      }
      const options = { sort: { createdAt: -1 } };

      const cursor = decorationsCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/decorations/decorator", async (req, res) => {
      const { decoratorEmail, workStatus } = req.query;
      const query = {};
      if (decoratorEmail) {
        query.decoratorEmail = decoratorEmail;
      }

      if (workStatus) {
        if (workStatus === "setup_completed") {
          query.decorationStatus = "setup_completed";
        } else if (workStatus === "materials_prepared") {
          query.decorationStatus = { $nin: ["setup_completed"] };
        } else {
          query.decorationStatus = workStatus;
        }
      }

      const cursor = decorationsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/decorations/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await decorationsCollection.findOne(query);
      res.send(result);
    });

    app.post("/decorations", verifyFBToken, verifyAdmin, async (req, res) => {
      const decoration = req.body;

      // Decoration Created time
      decoration.createdAt = new Date();

      const result = await decorationsCollection.insertOne(decoration);
      res.send(result);
    });

    app.patch("/decorations/:id", async (req, res) => {
      const { decoratorId, decoratorName, decoratorEmail } = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const updatedDoc = {
        $set: {
          decorationStatus: "materials_prepared",
          decoratorId: decoratorId,
          decoratorName: decoratorName,
          decoratorEmail: decoratorEmail,
        },
      };
      const result = await decorationsCollection.updateOne(query, updatedDoc);

      // update decorator information
      const decoratorQuery = { _id: new ObjectId(decoratorId) };
      const decoratorUpdatedDoc = {
        $set: {
          workStatus: "in_delivery",
        },
      };
      const decoratorResult = await decoratorsCollection.updateOne(
        decoratorQuery,
        decoratorUpdatedDoc
      );

      // log tracking
      // logTracking(trackingId, "materials_prepared" )

      res.send(decoratorResult);
    });

    app.patch("/decorations/:id/status", async (req, res) => {
      const { decorationStatus, decoratorId } = req.body;
      const query = { _id: new ObjectId(req.params.id) };
      const updatedDoc = {
        $set: {
          decorationStatus: decorationStatus,
        },
      };

      if (decorationStatus === "setup_completed") {
        // update decorator information
        const decoratorQuery = { _id: new ObjectId(decoratorId) };
        const decoratorUpdatedDoc = {
          $set: {
            workStatus: "available",
          },
        };
        const decoratorResult = await decoratorsCollection.updateOne(
          decoratorQuery,
          decoratorUpdatedDoc
        );
      }

      const result = await decorationsCollection.updateOne(query, updatedDoc);
      // log tracking
      // logTracking(trackingId, decorationStatus)
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
        customer_email: paymentInfo.customerEmail,
        metadata: {
          decorationId: paymentInfo.decorationId,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        const transactionId = session.payment_intent;
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

        const trackingId = generateTrackingId();

        if (session.payment_status === "paid") {
          const id = session.metadata.decorationId;
          const queryDecoration = { _id: new ObjectId(id) };

          const update = {
            $set: {
              paymentStatus: "paid",
              decorationStatus: "assigned-decorator",
              trackingId: trackingId,
            },
          };
          const result = await decorationsCollection.updateOne(
            queryDecoration,
            update
          );

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

          // logTracking(trackingId, 'assigned_decorator')

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
      // const cursor = paymentsCollection.find(query).sort({ paidAt: -1 });
      // const result = await cursor.toArray();
      // res.send(result);
      try {
        const result = await paymentsCollection
          .aggregate([
            { $match: query },
            { $sort: { paidAt: -1 } },
            // Join with decorations to get the status
            {
              $lookup: {
                from: "decorations",
                let: { decorationIdObj: { $toObjectId: "$decorationId" } }, // Convert string ID to ObjectId
                pipeline: [
                  { $match: { $expr: { $eq: ["$_id", "$$decorationIdObj"] } } },
                ],
                as: "decorationInfo",
              },
            },
            {
              $unwind: {
                path: "$decorationInfo",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $addFields: {
                workStatus: "$decorationInfo.decorationStatus", // Get the status
              },
            },
            {
              $project: {
                decorationInfo: 0, // Clean up
              },
            },
          ])
          .toArray();

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Error fetching payments" });
      }
    });

    // decorator related apis

    app.get("/decorators", async (req, res) => {
      const { status, workStatus } = req.query;

      const query = {};
      if (status) {
        query.status = status;
      }
      if (workStatus) {
        query.workStatus = workStatus;
      }

      try {
        const result = await decoratorsCollection
          .aggregate([
            { $match: query },
            {
              $lookup: {
                from: "users",
                localField: "decoratorEmail",
                foreignField: "email",
                as: "userDetails",
              },
            },

            {
              $unwind: {
                path: "$userDetails",
                preserveNullAndEmptyArrays: true,
              },
            },

            {
              $addFields: {
                decoratorImage: "$userDetails.photoURL",
              },
            },

            {
              $project: {
                userDetails: 0,
              },
            },
          ])
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching decorators:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.post("/decorators", async (req, res) => {
      const decorator = req.body;
      decorator.status = "pending";
      decorator.createdAt = new Date();

      const result = await decoratorsCollection.insertOne(decorator);
      res.send(result);
    });

    app.patch(
      "/decorators/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { status, email } = req.body;
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status: status,
            workStatus: "available",
          },
        };

        const result = await decoratorsCollection.updateOne(query, updatedDoc);

        if (status === "approved" && email) {
          // const email = req.body.email;
          // const userQuery = { email: email };
          const userQuery = {
            email: { $regex: new RegExp(`^${email}$`, "i") },
          };
          const updateUser = {
            $set: {
              role: "decorator",
            },
          };
          const userResult = await usersCollection.updateOne(
            userQuery,
            updateUser
          );
          console.log(`Updated user role for ${email}:`, userResult);
        }

        res.send(result);
      }
    );

    app.delete("/decorators/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await decoratorsCollection.deleteOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
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
