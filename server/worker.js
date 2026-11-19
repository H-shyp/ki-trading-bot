// KI Trading Bot – Cloudflare Worker
// Ein Zeitplan ruft jede Minute den Bot auf. Der Bot selbst lebt in einem Durable Object
// (eigener kleiner Speicher, steht in Europa), damit sein Stand zwischen den Runden erhalten bleibt.
import { DurableObject } from "cloudflare:workers";
import { makeBot } from "./core.js";

export class Bot extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.bot = makeBot({
      env: (k) => env[k],
      getMany: async (keys) => Object.fromEntries(await ctx.storage.get(keys)),
      putMany: async (obj) => ctx.storage.put(obj),
    });
  }
  async fetch(req) { return this.bot.handle(req); }
  async tick() { return this.bot.tick(); }
}

const botStub = (env) => env.BOT.get(env.BOT.idFromName("main"), { locationHint: "weur" });

export default {
  async fetch(req, env) { return botStub(env).fetch(req); },
  async scheduled(event, env, ctx) { ctx.waitUntil(botStub(env).tick()); },
};
