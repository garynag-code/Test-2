using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Accounting.Infrastructure.Persistence.Migrations;

/// <summary>
/// Database-level enforcement of the accounting invariants in specification section 9.1.
/// These guards apply to every connection, including direct SQL access, so no application
/// defect or ad-hoc statement can silently alter a posted accounting record.
///
/// Recovery note: the down migration removes the guards only. It does not alter data, so a
/// downgrade leaves posted records intact but unprotected at the database boundary.
/// </summary>
public partial class PostedJournalImmutabilityTriggers : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // INV-004: a posted journal header may never be edited, except for the single controlled
        // transition to Reversed that records which journal reversed it (INV-005).
        migrationBuilder.Sql("""
            CREATE OR REPLACE FUNCTION accounting_guard_journal_update() RETURNS trigger AS $$
            BEGIN
                IF OLD.status NOT IN ('Posted', 'Reversed') THEN
                    RETURN NEW;
                END IF;

                IF OLD.status = 'Posted' AND NEW.status = 'Reversed'
                   AND OLD.reversed_by_journal_id IS NULL
                   AND NEW.reversed_by_journal_id IS NOT NULL
                   AND NEW.id = OLD.id
                   AND NEW.entity_id = OLD.entity_id
                   AND NEW.journal_number = OLD.journal_number
                   AND NEW.journal_type = OLD.journal_type
                   AND NEW.transaction_date = OLD.transaction_date
                   AND NEW.period_id = OLD.period_id
                   AND NEW.posted_by IS NOT DISTINCT FROM OLD.posted_by
                   AND NEW.posted_at_utc IS NOT DISTINCT FROM OLD.posted_at_utc
                   AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
                   AND NEW.description IS NOT DISTINCT FROM OLD.description
                   AND NEW.reference IS NOT DISTINCT FROM OLD.reference
                   AND NEW.source_module = OLD.source_module
                   AND NEW.source_record_id IS NOT DISTINCT FROM OLD.source_record_id
                   AND NEW.reversal_of_journal_id IS NOT DISTINCT FROM OLD.reversal_of_journal_id
                THEN
                    RETURN NEW;
                END IF;

                RAISE EXCEPTION 'INV-004: posted journal % cannot be modified; post a reversing journal instead',
                    OLD.journal_number USING ERRCODE = 'integrity_constraint_violation';
            END;
            $$ LANGUAGE plpgsql;
            """);

        migrationBuilder.Sql("""
            CREATE OR REPLACE FUNCTION accounting_guard_journal_delete() RETURNS trigger AS $$
            BEGIN
                IF OLD.status IN ('Posted', 'Reversed') THEN
                    RAISE EXCEPTION 'INV-004: posted journal % cannot be deleted; post a reversing journal instead',
                        OLD.journal_number USING ERRCODE = 'integrity_constraint_violation';
                END IF;
                RETURN OLD;
            END;
            $$ LANGUAGE plpgsql;
            """);

        // Journal lines of a posted journal are immutable in every respect.
        migrationBuilder.Sql("""
            CREATE OR REPLACE FUNCTION accounting_guard_journal_line_change() RETURNS trigger AS $$
            DECLARE
                line_status text;
                line_journal uuid;
            BEGIN
                line_journal := COALESCE(NEW.journal_id, OLD.journal_id);
                SELECT status INTO line_status FROM journals WHERE id = line_journal;

                IF line_status IN ('Posted', 'Reversed') THEN
                    RAISE EXCEPTION 'INV-004: journal lines of posted journal % cannot be changed', line_journal
                        USING ERRCODE = 'integrity_constraint_violation';
                END IF;

                RETURN COALESCE(NEW, OLD);
            END;
            $$ LANGUAGE plpgsql;
            """);

        // INV-001: no posted journal may be unbalanced. Deferred to commit time so the journal
        // and its lines are all present, and scoped to the affected journal only.
        migrationBuilder.Sql("""
            CREATE OR REPLACE FUNCTION accounting_assert_journal_balanced() RETURNS trigger AS $$
            DECLARE
                debits numeric(19,4);
                credits numeric(19,4);
                line_count integer;
            BEGIN
                IF NEW.status NOT IN ('Posted', 'Reversed') THEN
                    RETURN NULL;
                END IF;

                SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0), COUNT(*)
                INTO debits, credits, line_count
                FROM journal_lines WHERE journal_id = NEW.id;

                IF line_count < 2 THEN
                    RAISE EXCEPTION 'INV-001: posted journal % has % line(s); at least two are required',
                        NEW.journal_number, line_count USING ERRCODE = 'integrity_constraint_violation';
                END IF;

                IF debits <> credits THEN
                    RAISE EXCEPTION 'INV-001: posted journal % is unbalanced (debits %, credits %)',
                        NEW.journal_number, debits, credits USING ERRCODE = 'integrity_constraint_violation';
                END IF;

                RETURN NULL;
            END;
            $$ LANGUAGE plpgsql;
            """);

        // The audit trail is append-only (specification section 9).
        migrationBuilder.Sql("""
            CREATE OR REPLACE FUNCTION accounting_guard_audit_events() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'Audit events are append-only and cannot be modified or deleted'
                    USING ERRCODE = 'integrity_constraint_violation';
            END;
            $$ LANGUAGE plpgsql;
            """);

        migrationBuilder.Sql("""
            CREATE TRIGGER trg_journals_guard_update BEFORE UPDATE ON journals
                FOR EACH ROW EXECUTE FUNCTION accounting_guard_journal_update();
            CREATE TRIGGER trg_journals_guard_delete BEFORE DELETE ON journals
                FOR EACH ROW EXECUTE FUNCTION accounting_guard_journal_delete();
            CREATE TRIGGER trg_journal_lines_guard BEFORE UPDATE OR DELETE ON journal_lines
                FOR EACH ROW EXECUTE FUNCTION accounting_guard_journal_line_change();
            CREATE CONSTRAINT TRIGGER trg_journals_balanced
                AFTER INSERT OR UPDATE ON journals DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION accounting_assert_journal_balanced();
            CREATE TRIGGER trg_audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
                FOR EACH ROW EXECUTE FUNCTION accounting_guard_audit_events();
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            DROP TRIGGER IF EXISTS trg_audit_events_append_only ON audit_events;
            DROP TRIGGER IF EXISTS trg_journals_balanced ON journals;
            DROP TRIGGER IF EXISTS trg_journal_lines_guard ON journal_lines;
            DROP TRIGGER IF EXISTS trg_journals_guard_delete ON journals;
            DROP TRIGGER IF EXISTS trg_journals_guard_update ON journals;
            DROP FUNCTION IF EXISTS accounting_guard_audit_events();
            DROP FUNCTION IF EXISTS accounting_assert_journal_balanced();
            DROP FUNCTION IF EXISTS accounting_guard_journal_line_change();
            DROP FUNCTION IF EXISTS accounting_guard_journal_delete();
            DROP FUNCTION IF EXISTS accounting_guard_journal_update();
            """);
    }
}
