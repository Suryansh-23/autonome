import { isbot } from "isbot";
import { Request, Response, NextFunction } from "express";

export function botDetection(req: Request, res: Response, next: NextFunction) {
    try {
        const isBot = isbot(req.headers['user-agent'] || '');
        if (isBot) {
            console.log("Bot detected:", req.headers['user-agent']);
            res.status(403).json({ message: "Access denied for bots" });
        } else {
            console.log("Human user detected:", req.headers['user-agent']);
            next();
        }
    } catch (error) {
        console.error("Error in bot detection middleware:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}