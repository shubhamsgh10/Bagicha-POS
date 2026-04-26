import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Plus, Edit2, Trash2, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Category {
  id: number;
  name: string;
  description?: string;
  displayOrder?: number;
}

function parseError(err: any): string {
  const raw: string = err?.message ?? "";
  const jsonStart = raw.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      if (parsed?.message) return parsed.message;
    } catch {}
  }
  return raw || "Something went wrong";
}

interface SortableCategoryRowProps {
  cat: Category;
  editingId: number | null;
  editName: string;
  editDesc: string;
  onEditStart: (cat: Category) => void;
  onEditNameChange: (v: string) => void;
  onEditDescChange: (v: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onDelete: (cat: Category) => void;
  isSaving: boolean;
}

function SortableCategoryRow({
  cat, editingId, editName, editDesc,
  onEditStart, onEditNameChange, onEditDescChange,
  onEditSave, onEditCancel, onDelete, isSaving,
}: SortableCategoryRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: cat.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-xl bg-white/50 border border-white/40 shadow-sm p-3"
    >
      {editingId === cat.id ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={editName}
              onChange={(e) => onEditNameChange(e.target.value)}
              className="h-7 text-sm"
            />
            <Input
              value={editDesc}
              onChange={(e) => onEditDescChange(e.target.value)}
              placeholder="Description"
              className="h-7 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={onEditSave}
              disabled={!editName.trim() || isSaving}
            >
              Save
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onEditCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {/* drag handle */}
          <button
            className="touch-none cursor-grab text-gray-300 hover:text-gray-500 flex-shrink-0"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{cat.name}</p>
            {cat.description && <p className="text-xs text-muted-foreground truncate">{cat.description}</p>}
          </div>
          <div className="flex gap-1 flex-shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => onEditStart(cat)}
            >
              <Edit2 className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              onClick={() => onDelete(cat)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CategoriesTab() {
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [localOrder, setLocalOrder] = useState<Category[] | null>(null);

  const { data: serverCategories, isLoading } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
    select: (data) => [...data].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)),
  });

  // Use local order if dragging in progress, else server data
  const categories = localOrder ?? serverCategories ?? [];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: number[]) =>
      apiRequest("PUT", "/api/categories/reorder", { orderedIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setLocalOrder(null);
    },
    onError: () => {
      toast({ title: "Failed to save order", variant: "destructive" });
      setLocalOrder(null);
    },
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = categories.findIndex((c) => c.id === active.id);
    const newIndex = categories.findIndex((c) => c.id === over.id);
    const reordered = arrayMove(categories, oldIndex, newIndex);
    setLocalOrder(reordered);
    reorderMutation.mutate(reordered.map((c) => c.id));
  };

  const createMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/categories", { name: newName.trim(), description: newDesc.trim() || null }),
    onSuccess: () => {
      toast({ title: "Category created" });
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setNewName("");
      setNewDesc("");
    },
    onError: (err: any) => {
      toast({ title: "Failed to create category", description: parseError(err), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name, description }: { id: number; name: string; description: string }) =>
      apiRequest("PUT", `/api/categories/${id}`, { name, description: description || null }),
    onSuccess: () => {
      toast({ title: "Category updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setEditingId(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to update category", description: parseError(err), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/categories/${id}`),
    onSuccess: () => {
      toast({ title: "Category deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete category", description: parseError(err), variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      {/* Add Category */}
      <div className="rounded-2xl bg-white/40 border border-white/30 shadow-md p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Add New Category</p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Category Name *</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Pizza, Drinks, Desserts"
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description (optional)</Label>
              <Input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Short description"
                className="h-8"
              />
            </div>
          </div>
          <Button
            size="sm"
            disabled={!newName.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? (
              <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Adding...</>
            ) : (
              <><Plus className="w-3 h-3 mr-1" /> Add Category</>
            )}
          </Button>
        </div>
      </div>

      {/* Category List */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 bg-white/40 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {categories.length > 0 && (
            <p className="text-xs text-gray-400 flex items-center gap-1.5 px-1">
              <GripVertical className="w-3 h-3" /> Drag rows to reorder. POS reflects same order.
            </p>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {categories.map((cat) => (
                  <SortableCategoryRow
                    key={cat.id}
                    cat={cat}
                    editingId={editingId}
                    editName={editName}
                    editDesc={editDesc}
                    onEditStart={(c) => { setEditingId(c.id); setEditName(c.name); setEditDesc(c.description || ""); }}
                    onEditNameChange={setEditName}
                    onEditDescChange={setEditDesc}
                    onEditSave={() => updateMutation.mutate({ id: editingId!, name: editName, description: editDesc })}
                    onEditCancel={() => setEditingId(null)}
                    onDelete={(c) => {
                      if (confirm(`Delete category "${c.name}"? This will hide it from the menu.`)) {
                        deleteMutation.mutate(c.id);
                      }
                    }}
                    isSaving={updateMutation.isPending}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {categories.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No categories yet</p>
          )}
        </>
      )}
    </div>
  );
}
