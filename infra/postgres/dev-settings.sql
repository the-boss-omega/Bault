SELECT format('ALTER DATABASE %I SET statement_timeout = %L', current_database(), '30s') \gexec
