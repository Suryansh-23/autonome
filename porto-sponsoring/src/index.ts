import cors from "cors";
import "dotenv/config";
import express from "express";
import { Route, Router } from "porto/server";

const app = express();
const porto = Router({ basePath: "/porto" }).route(
  "/merchant",
  Route.merchant({
    address: process.env.MERCHANT_ADDRESS,
    key: process.env.MERCHANT_PRIVATE_KEY,
    sponsor: true,
  })
);

app.use(cors());
app.use(porto.listener);
app.listen(process.env.PORT, () => {
  console.log(`Server listening on port ${process.env.PORT}`);
});
