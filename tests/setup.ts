// Load local env for DB-backed tests (seed idempotency, signIn). Pure/unit tests
// (route-guard, session) do not depend on this.
import 'dotenv/config';
