import test from "node:test";
import assert from "node:assert/strict";
import {scrypt as nodeScrypt} from "node:crypto";
import {scryptAsync} from "@noble/hashes/scrypt.js";

const nodeDerive=(password,salt)=>new Promise((resolve,reject)=>nodeScrypt(password,salt,64,{N:16384,r:8,p:1},(e,k)=>e?reject(e):resolve(k)));

test("browser scrypt implementation matches the existing Node.js scrypt parameters",async()=>{
  const vectors=[
    ["Wishly example password 2026!","0123456789abcdef0123456789abcdef"],
    ["correct horse battery staple 2026","abcdef0123456789abcdef0123456789"]
  ];
  for(const [password,salt] of vectors){
    const browserCompatible=Buffer.from(await scryptAsync(new TextEncoder().encode(password),new TextEncoder().encode(salt),{N:16384,r:8,p:1,dkLen:64}));
    const node=await nodeDerive(password,salt);
    assert.equal(browserCompatible.toString("hex"),node.toString("hex"));
  }
});
