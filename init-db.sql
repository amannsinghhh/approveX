-- Databases
CREATE DATABASE approvex;
CREATE DATABASE sheetcompile;

-- Application roles (non-superuser, so Postgres RLS is enforced)
CREATE ROLE approvex_app LOGIN PASSWORD '<APPPASS>';
CREATE ROLE sheetcompile_app LOGIN PASSWORD '3886ec8e3fa369dccf7fb54c35b7dfb47def4cbedd8a12f5ae5b4b44b49d151b';

GRANT ALL PRIVILEGES ON DATABASE approvex     TO approvex_app;
GRANT ALL PRIVILEGES ON DATABASE sheetcompile TO sheetcompile_app;

\c approvex
GRANT ALL ON SCHEMA public TO approvex_app;

\c sheetcompile
GRANT ALL ON SCHEMA public TO sheetcompile_app;