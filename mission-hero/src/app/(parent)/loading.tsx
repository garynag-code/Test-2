import { PageSkeleton } from '@/components/ui/skeleton';

export default function ParentLoading() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-6">
      <PageSkeleton rows={4} />
    </div>
  );
}
