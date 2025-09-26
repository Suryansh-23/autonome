import { isbot } from "isbot";
import { Request, Response, NextFunction } from "express";

export function botDetection(req: Request, res: Response, next: NextFunction): boolean {
    try {
        const userAgent = req.headers['user-agent'] || '';
        return isbot(userAgent);
    } catch (error) {
        console.error("Error in bot detection middleware:", error);
        // res.status(500).json({ message: "Internal server error" });
        return false;
    }
}