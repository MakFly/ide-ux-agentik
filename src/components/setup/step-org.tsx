import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type OrgDraft = {
  name: string;
  slug: string;
  logoUrl?: string;
};

type StepOrgProps = {
  value: OrgDraft;
  onChange: (org: OrgDraft) => void;
  onNext: () => void;
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "");
}

export function StepOrg({ value, onChange, onNext }: StepOrgProps) {
  const handleNameChange = (name: string) => {
    onChange({
      ...value,
      name,
      slug: slugify(name),
    });
  };

  const handleSlugChange = (slug: string) => {
    onChange({
      ...value,
      slug,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onNext();
    }
  };

  const isValid = value.name.trim().length >= 2;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Create your organization</h2>
        <p className="mt-2 text-sm text-slate-600">
          Give your workspace a name. This represents your team or project.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="org-name">Organization Name *</Label>
          <Input
            id="org-name"
            placeholder="e.g., MyStartup, TeamAlpha"
            value={value.name}
            onChange={(e) => handleNameChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="mt-2"
            autoFocus
          />
          {value.name && value.name.length < 2 && (
            <p className="mt-1 text-xs text-red-500">Minimum 2 characters required</p>
          )}
        </div>

        <div>
          <Label htmlFor="org-slug">URL Slug</Label>
          <Input
            id="org-slug"
            placeholder="my-startup"
            value={value.slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="mt-2"
          />
          <p className="mt-1 text-xs text-slate-500">
            Auto-derived from name, editable. Use lowercase and hyphens only.
          </p>
        </div>
      </div>

      {isValid && <p className="text-xs text-green-600">✓ Ready to continue</p>}
    </div>
  );
}
