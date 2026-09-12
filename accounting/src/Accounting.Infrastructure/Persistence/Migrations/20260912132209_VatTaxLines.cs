using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Accounting.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class VatTaxLines : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "tax_line_id",
                table: "journal_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "tax_lines",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    vat_code_id = table.Column<Guid>(type: "uuid", nullable: false),
                    vat_code_snapshot = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    vat201_mapping_code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    treatment = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    rate_percent = table.Column<decimal>(type: "numeric(19,8)", nullable: false),
                    taxable_amount = table.Column<decimal>(type: "numeric(19,4)", nullable: false),
                    vat_amount = table.Column<decimal>(type: "numeric(19,4)", nullable: false),
                    recoverable_percentage = table.Column<decimal>(type: "numeric(19,8)", nullable: false),
                    recoverable_vat_amount = table.Column<decimal>(type: "numeric(19,4)", nullable: false),
                    direction = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    capital_flag = table.Column<bool>(type: "boolean", nullable: false),
                    transaction_date = table.Column<DateOnly>(type: "date", nullable: false),
                    no_vat_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tax_lines", x => x.id);
                    table.ForeignKey(
                        name: "fk_tax_lines__vat_codes_vat_code_id",
                        column: x => x.vat_code_id,
                        principalTable: "vat_codes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_journal_lines_tax_line_id",
                table: "journal_lines",
                column: "tax_line_id");

            migrationBuilder.CreateIndex(
                name: "IX_tax_lines_entity_id_transaction_date",
                table: "tax_lines",
                columns: new[] { "entity_id", "transaction_date" });

            migrationBuilder.CreateIndex(
                name: "IX_tax_lines_entity_id_vat201_mapping_code",
                table: "tax_lines",
                columns: new[] { "entity_id", "vat201_mapping_code" });

            migrationBuilder.CreateIndex(
                name: "ix_tax_lines_vat_code_id",
                table: "tax_lines",
                column: "vat_code_id");

            migrationBuilder.AddForeignKey(
                name: "fk_journal_lines__tax_lines_tax_line_id",
                table: "journal_lines",
                column: "tax_line_id",
                principalTable: "tax_lines",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_journal_lines__tax_lines_tax_line_id",
                table: "journal_lines");

            migrationBuilder.DropTable(
                name: "tax_lines");

            migrationBuilder.DropIndex(
                name: "ix_journal_lines_tax_line_id",
                table: "journal_lines");

            migrationBuilder.DropColumn(
                name: "tax_line_id",
                table: "journal_lines");
        }
    }
}
