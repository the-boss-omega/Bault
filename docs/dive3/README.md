# DIVE3 — Bault in about 18.5 hours

DIVE3 takes you from not having read this code to knowing it well enough to change any part of it safely, and then to production. It has three stages. Read them in order: each one builds on the one before. It replaces the earlier DIVE2 guides.

| Stage | What you do | Time |
|---|---|---|
| [1. Theory](stage-1-theory.md) | The whole system without code: the business, the vocabulary, the architecture and every design choice, in the order that builds on itself | about 2.5 h, in two sessions |
| [2. The code](stage-2/) | Every file that matters, in order. Read the entry, then skim the file | about 5 h |
| [3. Practice](stage-3-practice.md) | The fixes production needs, done by hand, each with a failing test first | about 11 h |

After DIVE3: design work (5 to 10 hours), then staging, the live provider checks and production, as the launch plan sets out.

## The schedule

| Sitting | Read | Time |
|---|---|---|
| 1 | Stage 1, Session 1: T1 to T7, the system and its foundations | 75 min |
| 2 | Stage 1, Session 2: T8 to T18, money, goods and operations | 75 min |
| 3 | [2.1 Foundation](stage-2/01-foundation.md), [2.2 API core](stage-2/02-api-core.md), [2.3 Accounts and security](stage-2/03-accounts-security.md) | 85 min |
| 4 | [2.4 Money](stage-2/04-money.md), [2.5 Goods](stage-2/05-goods.md) | 75 min |
| 5 | [2.6 Marketplace and services](stage-2/06-marketplace-services.md), [2.7 Shipping](stage-2/07-shipping.md), [2.8 Worker](stage-2/08-worker.md) | 80 min |
| 6 | [2.9 Web app](stage-2/09-web.md), [2.10 Infrastructure, CI and tests](stage-2/10-infra-ci-tests.md) | 70 min |
| 7 to 11 | Stage 3: six groups of tasks, one pull request per group (its time budget table lists each one) | 10 h 55 min |

## How to read it
- **Stage 1 has no code.** Read it straight through. Each section ends with two or three questions; answer them before you open the answers. If one stumps you, reread that section, not the whole session.
- **Stage 2 is read next to the code.** Open the repository in an editor that can jump to a symbol: "Go to symbol in workspace" in VS Code, or Ctrl+T.
  - For each entry: read it, open the file, and skim it with the entry beside you. The minutes in each heading include the skim.
  - Entries name symbols, never line numbers, so they stay right while you change the code in Stage 3.
- **Stage 3 is hands-on.** Follow "How to work" at its top. Each task says what must be true, which test to write first, and when it is done. The hints get more specific as you open them; try without them first.

## Conventions
- **T-numbers** (for example T8.3) point at a section of Stage 1. When an entry or task cites one you don't remember, read that section again.
- **The code has no comments, on purpose.** This guide explains it. When you change the code in Stage 3, keep it that way: put the reason in the pull request, and in the test name.
- **Names in `code font`** are exact. Search for them as written.
- **The code this guide describes** is `master` after pull requests #9 to #15 are merged, #15 being this guide. Merge them before you start Stage 2, from the top down and with merge commits, as the launch plan's Day 1 sets out, and start every Stage 3 branch from that `master`.
