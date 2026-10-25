import { mock } from "bun:test";
import { z } from "zod";

mock.module("npm:zod@4.6.7", () => ({ z }));
