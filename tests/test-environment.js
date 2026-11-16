// Keep isolated test fixtures independent of a developer's .env or demo seed flags.
process.env.NODE_ENV = "test";
process.env.DEMO_ENABLED = "true";
process.env.SEED_FINANCE_DEMO = "false";
process.env.PAYMENT_PROVIDER = "sandbox";
process.env.SANDBOX_ENABLED = "true";
process.env.SEED_PROJECT_DEMO = "false";
process.env.SEED_ADMIN_DEMO = "false";
