-- pgvector is required for embeddings and similarity search (PGlite ships it; on Postgres it needs the extension available).
CREATE EXTENSION IF NOT EXISTS vector;
