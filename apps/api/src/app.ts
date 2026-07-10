import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import router from "./routers/index.js";

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(router);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: err.message },
  });
});

export default app;
