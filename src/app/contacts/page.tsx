import Nav from "@/components/nav";
import AiBar from "@/components/ai-bar";
import ContactsContent from "@/components/contacts-content";

export default function ContactsPage() {
  return (
    <>
      <Nav />
      <main className="relative z-[1] px-7 py-[22px] max-w-[1480px] mx-auto">
        <AiBar />
        <ContactsContent />
      </main>
    </>
  );
}
