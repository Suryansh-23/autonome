import { BackgroundLines } from "@/components/ui/background-lines";
import { AsciiHero } from "@/components/ui/ascii-hero";

export default function Home() {
  return (
    <section className="relative h-[calc(100vh-84px)] overflow-hidden flex items-center">
      <BackgroundLines className="absolute inset-0 -z-10" svgOptions={{ duration: 12 }}>
        <div className="sr-only">bg</div>
      </BackgroundLines>
      <div className="mx-auto max-w-6xl px-6 sm:px-10">
        <AsciiHero />
      </div>
    </section>
  );
}
