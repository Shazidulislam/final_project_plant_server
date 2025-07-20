require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const stripe = require('stripe')(process.env.STRIPE_SK_KEY)
const jwt = require('jsonwebtoken')

const port = process.env.PORT || 3000
const app = express()
// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      // console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
      // database
    const db = client.db("plantBD")
    // collection
    const plantCollection = db.collection("plants");
    const ordersCollection = db.collection("orders");
    const userCollection  = db.collection("users")
  try {
     //verify admin
    const verifydmin = (req , res , next)=>{
      const email = req?.user?.email;
      const user = userCollection.findOne({email,})
      if(  !user|| user?.role !== "admin") return res.status(403).send({message:"Only admin can action"})
        next()
    }

    // Generate jwt token
    app.post('/jwt', async (req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })
    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    })

   
    //add a plant in db
    app.post("/add-plant" , async(req , res)=>{
      const plantData = req.body;
      const result = await plantCollection.insertOne(plantData)
      res.send(result)
    })
    //get all plants data from db
    app.get("/plants" , async(req , res)=>{
      const result = await plantCollection.find().toArray()
      res.send(result)
    })
    //get a plant data from db
    app.get("/plant/:id" , async(req , res)=>{
      const {id}= req.params
      const filter = {_id : new ObjectId(id)}
      const result = await plantCollection.findOne(filter)
      res.send(result) 
    })
    //create payment intent for order
    app.post("/create-payment-intent" , 
      async(req , res)=>{
      const {quantity , plantId} = req.body;
      const filter = {_id : new ObjectId(plantId)}
      const plant = await plantCollection.findOne(filter)
      if(!plant)return res.status(404).send({message:"Plant not found!"})
      const totalPrice = quantity * plant?.price * 100
         //strie
           const {client_secret} = await stripe.paymentIntents.create({
           amount: totalPrice,
           currency: 'usd',
           automatic_payment_methods: {
             enabled: true, // 🔥 This enables Stripe to automatically detect the best payment methods
           },
    });
      res.send({secret:client_secret})
    })
    //save orders data in ordersCollection
    app.post("/orders" , async(req , res)=>{
      const orderData = req.body;
      const result = await ordersCollection.insertOne(orderData)
      res.send(result)
    })
    //after purche order update plant quantity
    app.patch("/update_plant_quantity/:id" ,
       async(req , res)=>{
      const {id} = req?.params;
      const filter = {_id : new ObjectId(id)}
      const { updateQuantity, status } = req.body;
      const updateDoc ={
        $inc:{
          quantity: status === "decrease" ? -updateQuantity : updateQuantity
        }
      }
      const result = await plantCollection.updateOne(filter , updateDoc ) 
      res.send(result)
    })
    //save and update user info in userCollection
    app.post("/user" ,
       async(req , res)=>{
      const userData = req.body;
        userData.role = "customer";
        userData.create_at = new Date().toISOString()
        userData.last_login = new Date().toISOString()
        const qurey = {email:userData?.email}
      const alreadyExsit = await userCollection.findOne(qurey)
      //if data is already have then update only last login data
      if(!!alreadyExsit){
        const updateDoc ={
          $set:{
            last_login: new Date().toISOString()
          }
        }
        const updateResult = await userCollection.updateOne(qurey ,updateDoc , {upsert:true} )
        return res.send(updateResult)
      }
      const result = await userCollection.insertOne(userData)
      res.send(result)
    })
    //get  user role
    app.get("/user-role/:email"
       , async(req , res)=>{
      const {email} = req.params
      const result = await userCollection.findOne({email,})
      if(!result){
        return res.status(401).send({message:"user not found!"})
      }
      res.send({role:result?.role})
    })
    //update user rolr
    app.patch("/user/role/update/:email"
       ,verifyToken, 
       async(req ,res)=>{
       const {email} = req.params;
       const {role} = req.body
       console.log(role)
       const filter= {email,}
       const updateDoc = {
        $set:{
          role,
          status:"verified",
        }
       }
       const result = await userCollection.updateOne(filter , updateDoc ,{upsert:true})
       console.log(result)
       res.send(result)
    })
    //become a seller requsted
    app.patch("/user/become-seller/:email" ,
       verifyToken
       , async(req , res)=>{
      const {email} = req.params;
      const filter = {email,}
      const updateDoc={
        $set:{
          status:"requsted",
        }
      }
      const result = await userCollection.updateOne(filter , updateDoc)
      res.send({result,})
    })
    //admin state
    app.get("/admin-state" 
      ,verifyToken
      , async(req , res)=>{
      const totalUsers = await userCollection.estimatedDocumentCount()
      const totalPlant = await plantCollection.estimatedDocumentCount()
      //mongodb aggregate
      const result = await ordersCollection.aggregate([
        {
          $addFields:{
            createAt:{ $toDate:"$_id" },
          },
        },
        {
          $group:{
            _id:{
              $dateToString:{
                format:'%Y-%m-%d',
                date:'$createAt'
              }
            },
             revenue:{$sum:'$price'},
             order:{$sum : 1}
          },
        }
      ]).toArray()
       
      const barChatData = result.map((data)=>({
        date : data?._id,
        revenue:data?.revenue,
        order:data?.order
      }))
      
      const totalRevenue= result.reduce((sum , data)=> sum+data?.revenue ,0)
      const totalOrder= result.reduce((sum , data)=> sum+data?.order ,0)
      // res.send({result })
      res.send({totalUsers  ,totalPlant , totalRevenue , totalOrder , barChatData })
    })
    //get all user data for admin
    app.get("/manage_user" 
      ,verifyToken, 
      async(req , res)=>{
      const{email} = req?.user
       const filter ={email: {
        $ne:email
       }}
      const result = await userCollection.find(filter).toArray()
      res.send(result)      
    })
    //customer order
    app.get("/customer/orders/:email" ,
       async(req , res)=>{
      const {email} = req.params
      filter={"customar.email":email}
      const result = await ordersCollection.find(filter).toArray()
      res.send(result)
    })
    //get all ordrinfo for seller
    app.get("/orders/seller/:email" 
      , async(req , res)=>{
      const {email} =req.params;
      const filter = {"seller.email":email}
      const result = await ordersCollection.find(filter).toArray()
      res.send(result)
    })
    //update order status
    app.patch("/orders/status/:id" , async(req , res)=>{
      const {id }= req.params;
      const filter = {_id:new ObjectId(id)}
      const {status} = req.body;
      const updateDoc ={
        $set:{
          status,
        }
      }
      const result = await ordersCollection.updateOne(filter , updateDoc)
      res.send(result)
    })
    app.patch("/orders/status/cancle/:id" , async(req , res)=>{
      const {id} = req.params
      const filter = {_id: new ObjectId(id)}
      const updateDoc = {
        $set:{
          status:"cancle"
        }
      }
      const result = await ordersCollection.updateOne(filter ,updateDoc , {upsert:true} )
      res.send(result)
    })

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from plantNet Server..')
})

app.listen(port, () => {
  console.log(`plantNet is running on port ${port}`)
})
