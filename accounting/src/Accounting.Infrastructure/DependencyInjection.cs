using Accounting.Application.Abstractions;
using Accounting.Application.EntitySetup;
using Accounting.Application.GeneralLedger;
using Accounting.Application.Security;
using Accounting.Infrastructure.Persistence;
using Accounting.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Accounting.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddAccountingInfrastructure(this IServiceCollection services,
        string connectionString)
    {
        services.AddDbContext<AccountingDbContext>(options => options.UseNpgsql(connectionString));
        services.AddScoped<IAccountingDbContext>(sp => sp.GetRequiredService<AccountingDbContext>());
        services.AddSingleton<IClock, SystemClock>();
        services.AddScoped<IAuditEventWriter, AuditEventWriter>();
        services.AddScoped<IEntityAccessService, EntityAccessService>();
        services.AddScoped<IPostingService, PostingService>();
        services.AddScoped<IDraftJournalService, DraftJournalService>();
        services.AddScoped<ITrialBalanceService, TrialBalanceService>();
        services.AddScoped<IPeriodService, PeriodService>();
        services.AddScoped<IEntitySetupService, EntitySetupService>();
        return services;
    }
}
