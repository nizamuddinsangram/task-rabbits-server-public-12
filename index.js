require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const port = process.env.PORT || 8000;

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
