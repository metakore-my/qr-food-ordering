import { useTranslations } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { HomeBackground } from "@/components/layout/home-background";
import { HomeQrScanner } from "@/components/home/qr-scanner";
import { getSettings } from "@/lib/settings";

export async function generateMetadata() {
  const t = await getTranslations("metadata");
  const { appName } = await getSettings();
  return { title: t("appTitle", { appName }), description: t("appDescription") };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { appName } = await getSettings();

  return <HomePageContent appName={appName} />;
}

function StepIcon({ step }: { step: number }) {
  const iconClass = "h-6 w-6 text-primary-500";

  switch (step) {
    case 1:
      // QR code icon
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
        </svg>
      );
    case 2:
      // Menu/book icon
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
      );
    case 3:
      // Cart/shopping icon
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
        </svg>
      );
    case 4:
      // Checkmark/enjoy icon
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" />
        </svg>
      );
    default:
      return null;
  }
}

function HomePageContent({ appName }: { appName: string }) {
  const tCustomer = useTranslations("customer");

  const steps = [
    { step: 1, title: tCustomer("step1Title"), desc: tCustomer("step1Desc") },
    { step: 2, title: tCustomer("step2Title"), desc: tCustomer("step2Desc") },
    { step: 3, title: tCustomer("step3Title"), desc: tCustomer("step3Desc") },
    { step: 4, title: tCustomer("step4Title"), desc: tCustomer("step4Desc") },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50">
      <HomeBackground />
      <main className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl bg-white/90 px-6 py-8 shadow-lg backdrop-blur sm:px-10 sm:py-10">
          {/* Header */}
          <div className="mb-2 flex justify-end">
            <LocaleSwitcher />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-primary-500 sm:text-4xl">{appName}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {tCustomer("tagline")}
            </p>
          </div>

          {/* Divider */}
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs font-semibold tracking-wide text-gray-400 uppercase">
              {tCustomer("howToOrder")}
            </span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          {/* Steps */}
          <div className="space-y-4">
            {steps.map(({ step, title, desc }) => (
              <div key={step} className="flex gap-4">
                {/* Step number + icon */}
                <div className="flex flex-col items-center">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50">
                    <StepIcon step={step} />
                  </div>
                  {step < 4 && (
                    <div className="mt-1 h-full w-px bg-gray-200" />
                  )}
                </div>
                {/* Text */}
                <div className={step < 4 ? "pb-2" : ""}>
                  <p className="text-sm font-semibold text-gray-900">{title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="my-6 h-px bg-gray-200" />

          {/* QR Scanner */}
          <HomeQrScanner />
        </div>
      </main>
    </div>
  );
}
