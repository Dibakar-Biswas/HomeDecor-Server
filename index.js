const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config()
const port = process.env.port || 3000
const { MongoClient, ServerApiVersion } = require('mongodb');

// middleware
app.use(express.json());
app.use(cors())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@first-backend.5ob3yor.mongodb.net/?appName=first-backend`;


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db('home_decor_db');
    const decorationsCollection = db.collection('decorations');

    // decoration api

    app.get('/decorations', async(req, res) => {
        const query = {}

        const {email} = req.query;
        if(email){
          query.adminEmail = email;
        }

        const cursor = decorationsCollection.find(query);
        const result = await cursor.toArray();
        res.send(result)
    })

    app.post('/decorations', async(req, res) => {
      const decoration = req.body;
      const result = await decorationsCollection.insertOne(decoration);
      res.send(result)
    })

    
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Home is Decorating')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
