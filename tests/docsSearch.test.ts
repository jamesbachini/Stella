import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanMdxForSearch,
  docsPathToUrl,
  parseFrontmatter,
  retrieveStellarDocs
} from "../server/docsSearch";

const tempRoots: string[] = [];

async function createDocsRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "stella-docs-"));
  tempRoots.push(root);
  await mkdir(join(root, "tokens"), { recursive: true });
  await mkdir(join(root, "build", "guides", "transactions"), { recursive: true });
  await mkdir(join(root, "build", "guides", "rpc"), { recursive: true });
  await mkdir(join(root, "build", "apps"), { recursive: true });
  await mkdir(join(root, "build", "smart-contracts"), { recursive: true });
  await mkdir(join(root, "platforms", "anchor-platform"), { recursive: true });

  await writeFile(
    join(root, "tokens", "how-to-issue-an-asset.mdx"),
    `---
title: "Issue an Asset on Stellar"
description: "Learn how to issue a Stellar asset, set trustlines, and manage supply."
---

# Issue an Asset Tutorial

## Prerequisites

Create issuing and distribution accounts, fund them with XLM, and establish a trustline before sending the asset.

## Build the payment

\`\`\`js
const asset = new StellarSdk.Asset("ASTRO", issuer.publicKey());
\`\`\`
`
  );

  await writeFile(
    join(root, "build", "guides", "transactions", "fee-bump-transactions.mdx"),
    `---
title: Fee-Bump Transactions
description: Let one account pay fees for another transaction.
---

# Fee-Bump Transactions

Fee-bump transactions wrap an inner transaction so a fee source account can pay the transaction fee.
`
  );

  await writeFile(
    join(root, "build", "guides", "rpc", "simulateTransaction-Deep-Dive.mdx"),
    `---
title: simulateTransaction Deep Dive
description: Use Stellar RPC simulation to inspect Soroban contract invocation costs.
---

# simulateTransaction Deep Dive

Use \`server.simulateTransaction(transaction)\` before submitting Soroban invocations.
`
  );

  await writeFile(
    join(root, "platforms", "anchor-platform", "sep24.mdx"),
    `---
title: "SEP-24: Hosted Deposit and Withdrawal"
description: Interactive deposit and withdrawal flow for anchors.
---

# SEP-24

Use SEP-24 when the anchor hosts an interactive web flow for deposits and withdrawals.
`
  );

  await writeFile(
    join(root, "build", "apps", "privacy.mdx"),
    `---
title: Privacy on Stellar
---

# Privacy on Stellar

## Onchain ZK Verifiers

### UltraHonk Verifier

A verifier for circuits built with Aztec's Noir language and Barretenberg backend.

- **Repo**: [ultrahonk Stellar smart contract](https://github.com/indextree/ultrahonk_soroban_contract)
`
  );

  await writeFile(
    join(root, "build", "apps", "zk.mdx"),
    `---
title: ZK Proofs on Stellar
---

## BN254

While BN254 host functions provide the cryptographic operations needed for proof verification, developers must still generate proofs using higher-level systems, such as circuits written in Noir, and deploy verifier smart contracts on Stellar.
`
  );

  await writeFile(
    join(root, "build", "smart-contracts", "overview.mdx"),
    `---
title: An Overview of Smart Contracts on Stellar
---

# Overview

Smart contracts on Stellar are written with Soroban and can interact with accounts and assets.
`
  );

  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("docs search helpers", () => {
  it("parses frontmatter fields and returns the markdown body", () => {
    const parsed = parseFrontmatter(`---
title: "Issue an Asset"
description: Create and distribute assets.
sidebar_label: Assets
---

# Body`);

    expect(parsed.frontmatter).toEqual({
      title: "Issue an Asset",
      description: "Create and distribute assets.",
      sidebarLabel: "Assets"
    });
    expect(parsed.body.trim()).toBe("# Body");
  });

  it("cleans MDX wrappers while preserving fenced code", () => {
    const cleaned = cleanMdxForSearch(`import Widget from "./Widget";

<CodeExample>

\`\`\`js
import { Server } from "@stellar/stellar-sdk/rpc";
const server = new Server("https://soroban-testnet.stellar.org");
\`\`\`

</CodeExample>

Actual prose.`);

    expect(cleaned).not.toContain('import Widget from "./Widget"');
    expect(cleaned).toContain('import { Server } from "@stellar/stellar-sdk/rpc"');
    expect(cleaned).toContain("Actual prose.");
  });

  it("maps docs paths to public source URLs", () => {
    expect(docsPathToUrl("build/README.mdx")).toBe(
      "https://developers.stellar.org/docs/build"
    );
    expect(
      docsPathToUrl(
        "build/guides/transactions/fee-bump-transactions.mdx",
        "https://developers.stellar.org/docs",
        "overview"
      )
    ).toBe(
      "https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions#overview"
    );
  });
});

describe("local Stellar docs retrieval", () => {
  it("retrieves relevant asset issuance docs with source URLs", async () => {
    const docsRoot = await createDocsRoot();
    const docs = await retrieveStellarDocs("How do I issue an asset and set a trustline?", {
      docsRoot,
      maxContextChars: 5000
    });

    expect(docs.context).toContain("Issue an Asset");
    expect(docs.context).toContain("trustline");
    expect(docs.sources[0]).toEqual({
      title: "Issue an Asset on Stellar",
      url: "https://developers.stellar.org/docs/tokens/how-to-issue-an-asset"
    });
  });

  it("boosts exact API and protocol terms", async () => {
    const docsRoot = await createDocsRoot();
    const rpcDocs = await retrieveStellarDocs("How should I use simulateTransaction?", {
      docsRoot,
      maxContextChars: 4000
    });
    const sepDocs = await retrieveStellarDocs("Explain SEP-24 deposits", {
      docsRoot,
      maxContextChars: 4000
    });

    expect(rpcDocs.context).toContain("simulateTransaction Deep Dive");
    expect(sepDocs.context).toContain("SEP-24: Hosted Deposit and Withdrawal");
  });

  it("prioritizes rare exact ZK terms over broad smart contract pages", async () => {
    const docsRoot = await createDocsRoot();
    const docs = await retrieveStellarDocs(
      "Can you tell me how to verify noir circuits on Stellar smart contracts?",
      {
        docsRoot,
        maxContextChars: 5000
      }
    );

    expect(docs.sources.slice(0, 2).map((source) => source.title).sort()).toEqual([
      "Privacy on Stellar",
      "ZK Proofs on Stellar"
    ]);
    expect(docs.sources.findIndex((source) => source.title.includes("Smart Contracts"))).toBeGreaterThan(
      1
    );
    expect(docs.context).toContain("Noir language and Barretenberg backend");
    expect(docs.context).toContain("deploy verifier smart contracts on Stellar");
  });

  it("limits context size and handles missing docs gracefully", async () => {
    const docsRoot = await createDocsRoot();
    const docs = await retrieveStellarDocs("fee bump transaction", {
      docsRoot,
      maxContextChars: 900
    });
    const missing = await retrieveStellarDocs("fee bump transaction", {
      docsRoot: join(docsRoot, "missing")
    });

    expect(docs.context.length).toBeLessThanOrEqual(1100);
    expect(docs.context).toContain("Fee-Bump Transactions");
    expect(missing.context).toContain("Docs retrieval failed");
    expect(missing.sources).toEqual([]);
  });
});
