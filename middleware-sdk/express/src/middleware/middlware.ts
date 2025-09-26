import { Request, Response, NextFunction } from "express";
import { botDetection } from "../bot-detection/bot";


export function middleware(req: Request, res: Response, next: NextFunction) {
    console.log("Middleware executed");
    // res.json({ message: "Middleware executed" });
    botDetection(req, res, next);
}