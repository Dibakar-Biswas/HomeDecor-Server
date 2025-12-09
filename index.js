const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config()
const port = process.env.port || 3000

// middleware
app.use(express.json());
app.use(cors())

app.get('/', (req, res) => {
  res.send('Home is Decorating')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
