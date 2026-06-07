import { registerHooks } from "node:module";
import { load, resolve } from "./ts-loader.mjs";

registerHooks({ load, resolve });
