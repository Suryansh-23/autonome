import express from "express";
import path from "path";
import { middleware, Resource, setHeaderMiddleware } from "middleware-sdk";
import { config } from "dotenv";

config();
const app = express();

const facilitatorURL = process.env.FACILITATOR_URL as Resource;
const payTo = process.env.ADDRESS as `0x${string}`;
console.log("FACILITATOR_URL:", facilitatorURL);
console.log("ADDRESS:", payTo);
if (!payTo || !facilitatorURL) {
  console.error("Missing ADDRESS or FACILITATOR_URL environment variables");
  process.exit(1);
}

app.use(express.json());
app.use((req, res, next) => setHeaderMiddleware(payTo, res, next));
app.use(
  middleware(
    payTo,
    {
      "/*": { price: "$0.01", network: "polygon" },
    },
    {
      url: facilitatorURL,
    },
    undefined,
    undefined,
    undefined
  )
);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "..", "public")));

// Home route - serve the main index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "components", "index.html"));
});

// Notes route
app.get("/notes", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "components", "notes", "index.html"));
});

// Projects route
app.get("/projects", (req, res) => {
  res.sendFile(
    path.join(__dirname, "..", "components", "projects", "index.html")
  );
});

// Work route
app.get("/work", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "components", "work", "index.html"));
});

// Hello route
app.get("/hello", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "components", "hello", "index.html"));
});

// Side quests route
app.get("/side-quests", (req, res) => {
  res.sendFile(
    path.join(__dirname, "..", "components", "side-quests", "index.html")
  );
});

// About route (existing)
app.get("/about", function (req, res) {
  res.sendFile(path.join(__dirname, "..", "components", "about.htm"));
});

// 404 error handler - serve custom 404 page
app.get("*", (req, res) => {
  res
    .status(404)
    .sendFile(path.join(__dirname, "..", "components", "404.html"));
});

app.listen(process.env.PORT || 5000, () => {
  console.log(
    `HeySuri server is running on http://localhost:${process.env.PORT || 5000}`
  );
});

module.exports = app;
