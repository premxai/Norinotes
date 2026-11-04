import { Nav } from "@/components/Nav";
import { Faq } from "@/sections/Faq";
import { FinalCta } from "@/sections/FinalCta";
import { Footer } from "@/sections/Footer";
import { Hero } from "@/sections/Hero";
import { HowItWorks } from "@/sections/HowItWorks";
import { InCharge } from "@/sections/InCharge";
import { NoBoard } from "@/sections/NoBoard";
import { Pricing } from "@/sections/Pricing";
import { Replay } from "@/sections/Replay";
import { Smarter } from "@/sections/Smarter";
import { Tailored } from "@/sections/Tailored";
import { Wherever } from "@/sections/Wherever";

/** The landing page: sections 01 to 12 of docs/ui-plan.md, in order. */
export default function Home() {
  return (
    <>
      <Nav />
      <main id="main">
        <Hero />
        <NoBoard />
        <HowItWorks />
        <Replay />
        <Tailored />
        <InCharge />
        <Smarter />
        <Wherever />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
