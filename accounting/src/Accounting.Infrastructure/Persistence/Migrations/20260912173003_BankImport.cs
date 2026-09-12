using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Accounting.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class BankImport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "bank_accounts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    bank_key = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    account_number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    branch_code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    currency_code = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    ledger_account_id = table.Column<Guid>(type: "uuid", nullable: false),
                    active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_bank_accounts", x => x.id);
                    table.ForeignKey(
                        name: "fk_bank_accounts_accounts_ledger_account_id",
                        column: x => x.ledger_account_id,
                        principalTable: "accounts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "bank_import_batches",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    bank_account_id = table.Column<Guid>(type: "uuid", nullable: false),
                    source_file_name = table.Column<string>(type: "character varying(260)", maxLength: 260, nullable: false),
                    file_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    parser_key = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    statement_from = table.Column<DateOnly>(type: "date", nullable: true),
                    statement_to = table.Column<DateOnly>(type: "date", nullable: true),
                    row_count = table.Column<int>(type: "integer", nullable: false),
                    imported_count = table.Column<int>(type: "integer", nullable: false),
                    duplicate_count = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    imported_by = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    imported_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_bank_import_batches", x => x.id);
                    table.ForeignKey(
                        name: "fk_bank_import_batches_bank_accounts_bank_account_id",
                        column: x => x.bank_account_id,
                        principalTable: "bank_accounts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "bank_transactions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    bank_account_id = table.Column<Guid>(type: "uuid", nullable: false),
                    import_batch_id = table.Column<Guid>(type: "uuid", nullable: false),
                    transaction_date = table.Column<DateOnly>(type: "date", nullable: false),
                    amount = table.Column<decimal>(type: "numeric(19,4)", nullable: false),
                    statement_balance = table.Column<decimal>(type: "numeric(19,4)", nullable: true),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    detail = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    source_row_number = table.Column<int>(type: "integer", nullable: false),
                    duplicate_ordinal = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    journal_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_bank_transactions", x => x.id);
                    table.ForeignKey(
                        name: "fk_bank_transactions_bank_import_batches_import_batch_id",
                        column: x => x.import_batch_id,
                        principalTable: "bank_import_batches",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_bank_accounts_entity_id_name",
                table: "bank_accounts",
                columns: new[] { "entity_id", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_bank_accounts_ledger_account_id",
                table: "bank_accounts",
                column: "ledger_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_bank_import_batches_bank_account_id_file_hash",
                table: "bank_import_batches",
                columns: new[] { "bank_account_id", "file_hash" });

            migrationBuilder.CreateIndex(
                name: "IX_bank_import_batches_entity_id_imported_at_utc",
                table: "bank_import_batches",
                columns: new[] { "entity_id", "imported_at_utc" });

            migrationBuilder.CreateIndex(
                name: "IX_bank_transactions_bank_account_id_transaction_date",
                table: "bank_transactions",
                columns: new[] { "bank_account_id", "transaction_date" });

            migrationBuilder.CreateIndex(
                name: "IX_bank_transactions_entity_id_status",
                table: "bank_transactions",
                columns: new[] { "entity_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_bank_transactions_import_batch_id",
                table: "bank_transactions",
                column: "import_batch_id");

            migrationBuilder.CreateIndex(
                name: "IX_bank_transactions_journal_id",
                table: "bank_transactions",
                column: "journal_id",
                unique: true,
                filter: "journal_id IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "bank_transactions");

            migrationBuilder.DropTable(
                name: "bank_import_batches");

            migrationBuilder.DropTable(
                name: "bank_accounts");
        }
    }
}
