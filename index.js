require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const port = process.env.PORT || 8000;
const stripe = require("stripe")(process.env.STRIPE_SECRET);

app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:5174"],
  })
);
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vshvqji.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
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
    const usersCollection = client.db("task-rabbit").collection("users");
    const tasksCollection = client.db("task-rabbit").collection("tasks");
    const paymentCollection = client.db("task-rabbit").collection("payments");
    const withdrawCollection = client.db("task-rabbit").collection("withdraws");
    const submissionCollection = client
      .db("task-rabbit")
      .collection("submissions");
    // when a user register a account give point and store user data
    app.post("/register", async (req, res) => {
      const { name, email, role, image_url } = req.body;
      const existingUser = await usersCollection.findOne({ email });
      if (existingUser) {
        return res.status(400).send({ message: "Email already in use" });
      }
      const initialCoins = role === "Worker" ? 10 : 50;
      const newUser = {
        name,
        email,
        role,
        image_url,
        coins: initialCoins,
      };
      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });
    //when user can entry google account
    app.post("/google-login", async (req, res) => {
      const { name, email, image_url } = req.body;
      const isExit = await usersCollection.findOne({ email });
      if (isExit) {
        return res.send({
          message: "User already exists, logged in successfully",
        });
      }
      const newUser = {
        name,
        email,
        role: "Worker",
        image_url,
        coins: 10,
      };
      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });

    //find user role from database
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    app.post("/tasks/:email", async (req, res) => {
      const { total_cost, ...tasks } = req.body;
      // console.log(tasks, "i find total cost ", total_cost);

      const insertDoc = await tasksCollection.insertOne(tasks);
      //update a user
      const email = req.params.email;
      const filter = { email: email };
      const findUser = await usersCollection.findOne(filter);
      const updatedCoins = findUser.coins - total_cost;
      const updatedDoc = {
        $set: {
          coins: updatedCoins,
        },
      };
      const result = await usersCollection.updateOne(filter, updatedDoc);
      res.send({ insertDoc, result });
    });
    app.get("/tasks/:email", async (req, res) => {
      const email = req.params.email;
      const findTasks = await tasksCollection
        .find({
          "task_creator.creator_email": email,
        })
        .sort({ "task_creator.current_time": -1 })
        .toArray();
      res.send(findTasks);
    });
    app.delete("/tasks/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      // find the tasks in our tasks collecton
      const task = await tasksCollection.findOne(query);
      // find data in our tasks collection as we need
      const email = task.task_creator.creator_email;
      const task_quantity = task.task_quantity;
      const payable_amount = task.payable_amount;
      const coinsToAdd = task_quantity * payable_amount;
      // delete data from our tasks collection
      const result = await tasksCollection.deleteOne(query);
      //update my users collection data
      const filter = { email: email };
      const updatedDoc = {
        $inc: {
          coins: coinsToAdd,
        },
      };
      const updateCoinsData = await usersCollection.updateOne(
        filter,
        updatedDoc
      );
      res.send({ result, updateCoinsData });
    });
    //create a payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });
    // insert data payment collection
    app.post("/payment-info", async (req, res) => {
      const { email, name, amount, transactionId } = req.body;
      let coins = 0;
      if (amount === 1) {
        coins = 10;
      } else if (amount === 9) {
        coins = 100;
      } else if (amount === 19) {
        coins = 500;
      } else if (amount === 39) {
        coins = 1000;
      } else {
        return res.status(400).send({ message: "Invalid amount" });
      }
      //add paymentInfo to payment collection
      const paymentInfo = {
        name: name,
        email: email,
        amount: amount,
        coins: coins,
        transactionId: transactionId,
        date: new Date(),
      };
      //insert data form payment collection
      const paymentResult = await paymentCollection.insertOne(paymentInfo);
      // update data from user collecion
      const filter = { email: email };
      const updatedDoc = {
        $inc: {
          coins: coins,
        },
      };
      const updatedResult = await usersCollection.updateOne(filter, updatedDoc);
      res.send({ paymentResult, updatedResult });
    });
    app.get("/payment-info/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });
    //find all tasks task-quantity is getter than o worker
    app.get("/tasks", async (req, res) => {
      const result = await tasksCollection
        .find({ task_quantity: { $gt: 0 } })
        .toArray();
      res.send(result);
    });
    app.get("/singleTask/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await tasksCollection.findOne(query);
      res.send(result);
    });
    //post data my submission collection
    app.post("/submission", async (req, res) => {
      const submissionData = req.body;
      // console.log(submissionData);
      const result = await submissionCollection.insertOne(submissionData);
      res.send(result);
    });
    //some changes this api email changes worker email
    app.get("/submission/:workerEmail", async (req, res) => {
      const email = req.params.workerEmail;
      const query = { "workerInfo.worker_email": email };
      const result = await submissionCollection.find(query).toArray();
      res.send(result);
    });
    //find all submission by email any one can request to do thi work[Task Creator Home section ]
    app.get("/pendingSubmissions/:email", async (req, res) => {
      const email = req.params.email;
      const query = { creator_email: email, status: "pending" };
      const result = await submissionCollection.find(query).toArray();
      res.send(result);
    });
    //post data withdraw collection wow
    app.post("/withdraw", async (req, res) => {
      // const {

      //   worker_email,
      //   worker_name,
      //   withdraw_coin,
      //   withdraw_amount,
      //   payment_system,
      //   account_number,
      //   withdraw_time,
      // } = req.body;
      // const query = { email: worker_email };
      // //find user from usersCollections
      // const findUser = await usersCollection.findOne(query);
      // const newWithdrawal = {
      //   worker_email,
      //   worker_name,
      //   withdraw_coin,
      //   withdraw_amount,
      //   payment_system,
      //   account_number,
      //   withdraw_time,
      // };
      // const updatedDoc = {
      //   $inc: { coins: -withdraw_coin },
      // };
      // //update user coins from users colleciton
      // const updateUserCoins = await usersCollection.updateOne(
      //   query,
      //   updatedDoc
      // );
      //insert withdraw history from withdraw collection
      const newWithdrawal = req.body;
      const withdraw = await withdrawCollection.insertOne(newWithdrawal);
      res.send({ withdraw });
    });
    //pending submission find our database [worker home page]
    //i came mosque work this route insallah
    app.get("/submissionApprove/:workerEmail", async (req, res) => {
      const email = req.params.workerEmail;
      const query = { "workerInfo.worker_email": email, status: "approve" };
      const result = await submissionCollection.find(query).toArray();
      res.send(result);
    });
    //admin action related api
    //find worker withdraw data from withdraw collection
    app.get("/withDrawConfirmAdmin", async (req, res) => {
      const result = await withdrawCollection.find().toArray();
      res.send(result);
    });

    app.delete("/approveWithdraw/:id", async (req, res) => {
      const id = req.params.id;
      const withdrawRequest = await withdrawCollection.findOne({
        _id: new ObjectId(id),
      });
      //admin click on payment button and delete this from witdrow collectio
      //and update user collection
      //update coins form user collection
      const userCoinsUpdate = await usersCollection.updateOne(
        { email: withdrawRequest.worker_email },
        { $inc: { coins: -withdrawRequest.withdraw_coin } }
      );
      const deleteResult = await withdrawCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send({ userCoinsUpdate, deleteResult });
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
  res.send("task rabbit server started");
});
app.listen(port, () => {
  console.log(`running rabbit server on port ${port}`);
});

// reduce a coin
// app.patch("/user/reduce-coins/:email", async (req, res) => {
//   const email = req.params.email;
//   const filter = { email: email };
//   const { total_cost } = req.body;
//   const findUser = await usersCollection.findOne({ email });
//   console.log(typeof findUser.coins);
//   console.log(typeof total_cost);
//   console.log(total_cost);
//   const updatedCoins = findUser.coins - parseFloat(total_cost);
//   const updatedDoc = {
//     $set: {
//       coins: updatedCoins,
//     },
//   };
//   const result = await usersCollection.updateOne(filter, updatedDoc);
//   res.send(result);
// });
// // add a new tasks
// app.post("/tasks", async (req, res) => {
//   const tasks = req.body;
//   // console.log(tasks);
//   const result = await tasksCollection.insertOne(tasks);
//   res.send(result);
// });
