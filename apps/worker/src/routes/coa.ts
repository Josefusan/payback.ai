// Owner: L3. The chart of accounts, so the review screen can name the account a reviewer is overriding.
// No SQL here (T-L3-007): `coaListing` is a pure projection of the same list `accountExists` validates against.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { coaListing } from "../coa";

export const coa = new Hono<AppEnv>();

coa.get("/api/coa", (c) => c.json(coaListing()));
