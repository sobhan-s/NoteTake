import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import { API_PATHS } from "@shared/core/constants";
import router from "./routers/index.js";
import { errorMiddleware } from "./middlewares/error.middleware.js";
import { buildOpenApiDocument } from "./docs/openapi.js";

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(router);
app.use(
  `${API_PATHS.BASE}/docs`,
  swaggerUi.serve,
  swaggerUi.setup(buildOpenApiDocument()),
);

app.use(errorMiddleware);

export default app;
