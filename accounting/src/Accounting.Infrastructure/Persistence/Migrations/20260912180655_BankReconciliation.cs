using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Accounting.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class BankReconciliation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "bank_reconciliations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    bank_account_id = table.Column<Guid>(type: "uuid", nullable: false),
                    statement_date = table.Column<DateOnly>(type: "date", nullable: false),
                    statement_balance = table.Column<decimal>(type: "numeric(19,4)", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    final_ledger_balance = table.Column<decimal>(type: "numeric(19,4)", nullable: true),
                    final_unallocated_total = table.Column<decimal>(type: "numeric(19,4)", nullable: true),
                    final_outstanding_total = table.Column<decimal>(type: "numeric(19,4)", nullable: true),
                    final_unexplained_difference = table.Column<decimal>(type: "numeric(19,4)", nullable: true),
                    prepared_by = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    prepared_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    finalised_by = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    finalised_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_bank_reconciliations", x => x.id);
                    table.ForeignKey(
                        name: "fk_bank_reconciliations_bank_accounts_bank_account_id",
                        column: x => x.bank_account_id,
                        principalTable: "bank_accounts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "bank_reconciliation_lines",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    reconciliation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    journal_line_id = table.Column<Guid>(type: "uuid", nullable: false),
                    amount = table.Column<decimal>(type: "numeric(19,4)", nullable: false),
                    explanation = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    created_by = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_bank_reconciliation_lines", x => x.id);
                    table.ForeignKey(
                        name: "fk_bank_reconciliation_lines__journal_lines_journal_line_id",
                        column: x => x.journal_line_id,
                        principalTable: "journal_lines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_bank_reconciliation_lines_bank_reconciliations_reconciliati~",
                        column: x => x.reconciliation_id,
                        principalTable: "bank_reconciliations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_bank_reconciliation_lines_journal_line_id",
                table: "bank_reconciliation_lines",
                column: "journal_line_id");

            migrationBuilder.CreateIndex(
                name: "IX_bank_reconciliation_lines_reconciliation_id_journal_line_id",
                table: "bank_reconciliation_lines",
                columns: new[] { "reconciliation_id", "journal_line_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_bank_reconciliations_bank_account_id_statement_date",
                table: "bank_reconciliations",
                columns: new[] { "bank_account_id", "statement_date" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "bank_reconciliation_lines");

            migrationBuilder.DropTable(
                name: "bank_reconciliations");
        }
    }
}
