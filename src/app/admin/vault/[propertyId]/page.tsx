import Nav from "@/components/nav";
import VaultAdminContent from "@/components/vault-admin-content";

export default function VaultAdminPage({ params }: { params: { propertyId: string } }) {
  return (
    <>
      <Nav />
      <main className="relative z-[1] px-7 py-[22px] max-w-[1100px] mx-auto">
        <VaultAdminContent propertyId={params.propertyId} />
      </main>
    </>
  );
}
