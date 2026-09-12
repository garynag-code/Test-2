using Accounting.Domain.Enums;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Accounting.Infrastructure.Persistence;

/// <summary>
/// Applies migrations and provisions the role catalogue and first administrator
/// (specification section 7.2 installer requirements).
/// </summary>
public static class DatabaseInitializer
{
    public static async Task InitialiseAsync(IServiceProvider services, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var sp = scope.ServiceProvider;
        var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseInitializer");

        var db = sp.GetRequiredService<AccountingDbContext>();
        await db.Database.MigrateAsync(ct);

        var roleManager = sp.GetRequiredService<RoleManager<IdentityRole>>();
        foreach (var role in Roles.All)
            if (!await roleManager.RoleExistsAsync(role))
                await roleManager.CreateAsync(new IdentityRole(role));

        var configuration = sp.GetRequiredService<IConfiguration>();
        var email = configuration["Bootstrap:AdministratorEmail"];
        var password = configuration["Bootstrap:AdministratorPassword"];

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        {
            logger.LogInformation(
                "No bootstrap administrator configured. Set Bootstrap:AdministratorEmail and " +
                "Bootstrap:AdministratorPassword (environment variables or user secrets) to create one.");
            return;
        }

        var userManager = sp.GetRequiredService<UserManager<IdentityUser>>();
        if (await userManager.FindByEmailAsync(email) is not null) return;

        var user = new IdentityUser { UserName = email, Email = email, EmailConfirmed = true };
        var created = await userManager.CreateAsync(user, password);
        if (!created.Succeeded)
        {
            logger.LogError("Could not create the bootstrap administrator: {Errors}",
                string.Join("; ", created.Errors.Select(e => e.Description)));
            return;
        }

        await userManager.AddToRoleAsync(user, Roles.SystemAdmin);
        await userManager.AddToRoleAsync(user, Roles.FirmAdmin);
        logger.LogInformation("Created the bootstrap system administrator.");
    }
}
