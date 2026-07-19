// PUBLIC marketing homepage for the Love's Cleaning SERVICE (not the operator tool).
// Ungated (route guard opens '/'). Client-temperament styling — calm light surface,
// amber primary CTA (green is reserved for paid/confirmed elsewhere, unused here).
// Phone-first single scroll. The self-serve request form is inline (Task 7 core).
import Link from 'next/link';
import { RequestForm } from './request/RequestForm';

export const metadata = {
  title: "Love's Cleaning — a spotless home, no hassle",
  description:
    "Reliable home cleaning from a local, trusted cleaner. Request a clean online and we'll confirm a time.",
};

export default function HomePage() {
  return (
    <main className="marketing">
      {/* Hero */}
      <section className="hero">
        <h1>Love&apos;s Cleaning — a spotless home, no hassle.</h1>
        <p>Reliable, thorough cleaning from a local cleaner you can count on.</p>
        <a href="#request" className="cta-primary">Book a clean →</a>
      </section>

      {/* Services */}
      <section aria-labelledby="services-h">
        <h2 id="services-h">What we clean</h2>
        <ul className="cards">
          <li><strong>Regular clean</strong><span>Weekly or fortnightly upkeep that keeps the whole home fresh.</span></li>
          <li><strong>Deep clean</strong><span>A top-to-bottom reset — the corners a quick tidy always misses.</span></li>
          <li><strong>Move-out clean</strong><span>Hand the keys back spotless and get the deposit back.</span></li>
        </ul>
      </section>

      {/* Why us */}
      <section aria-labelledby="why-h">
        <h2 id="why-h">Why Love&apos;s Cleaning</h2>
        <ul className="cards">
          <li><strong>Dependable</strong><span>Show-up-on-time, same trusted cleaner every visit.</span></li>
          <li><strong>Thorough</strong><span>A real checklist, not a rushed once-over.</span></li>
          <li><strong>Local</strong><span>A neighbour, not a faceless agency.</span></li>
        </ul>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-h">
        <h2 id="how-h">How it works</h2>
        <ol className="steps">
          <li>Send a request with your details and a preferred day.</li>
          <li>We confirm a time that works for both of us.</li>
          <li>We clean — you come home to a spotless place.</li>
        </ol>
      </section>

      {/* Request form (CTA target) */}
      <section id="request" aria-labelledby="request-h">
        <h2 id="request-h">Request a clean</h2>
        <p>Tell us how to reach you and when you&apos;d like us — we&apos;ll be in touch to confirm.</p>
        <RequestForm />
      </section>

      <footer className="marketing-footer">
        <p>Serving the local area. Questions? Get in touch.</p>
        <Link href="/sign-in" className="operator-link">Operator sign-in</Link>
      </footer>
    </main>
  );
}
