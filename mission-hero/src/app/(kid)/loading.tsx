import { PageSkeleton } from '@/components/ui/skeleton';

export default function KidLoading() {
  return (
    <div className="mx-auto max-w-md px-5 py-8">
      <PageSkeleton rows={3} label="Getting your missions" />
    </div>
  );
}
