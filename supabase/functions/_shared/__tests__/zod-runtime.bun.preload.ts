import { mock } from "bun:test";
import { z } from "zod";

mock.module("npm:zod@4.1.12", () => ({ z }));
