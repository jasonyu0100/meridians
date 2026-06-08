'use client';
// MembersModal — dedicated TopBar interface for editing the room's member list.
// The table shows real members only; adding is a separate button. Blank rows are
// pruned on open/close so empty member objects never linger. Exactly one member
// should hold the GM role (the master device); the first member added is GM.

import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '@/lib/state/store';
import { MEMBER_ROLES, type Member, type MemberRole } from '@/types/narrative';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { IconTrash, IconPlus, IconUsers, IconCheck } from '@/components/icons';
import { useActiveMember, memberName } from '@/hooks/useActiveMember';

const uid = () => `member-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const ROLE_LABEL: Record<MemberRole, string> = { gm: 'GM', member: 'Member' };

const cellInput =
  'w-full bg-transparent px-2.5 py-1.5 text-[12px] text-text-primary outline-none placeholder:text-text-dim/30 focus:bg-white/5 rounded';

const isBlank = (p: { firstName?: string; lastName?: string; mobile?: string }) =>
  !p.firstName?.trim() && !p.lastName?.trim() && !p.mobile?.trim();

export function MembersModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const n = state.activeNarrative;
  const members = useMemo(() => Object.values(n?.members ?? {}), [n?.members]);
  const { memberId: activeMemberId, setMemberId } = useActiveMember();
  // Named members only — a blank, never-filled row shouldn't be selectable.
  const namedMembers = members.filter((m) => m.firstName?.trim() || m.lastName?.trim());

  // Drop blank member objects when the modal opens and again when it closes, so
  // an added-but-never-filled row never persists as a dead row.
  const membersRef = useRef(members);
  membersRef.current = members;
  const pruneBlanks = () => {
    for (const p of membersRef.current) if (isBlank(p)) dispatch({ type: 'REMOVE_MEMBER', id: p.id });
  };
  useEffect(() => {
    pruneBlanks();
    return pruneBlanks;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (member: Member, p: Partial<Member>) =>
    dispatch({ type: 'UPSERT_MEMBER', member: { ...member, ...p } });

  const addMember = () =>
    dispatch({
      type: 'UPSERT_MEMBER', member: { id: uid(), firstName: '', lastName: '', role: members.length === 0 ? 'gm' : 'member' },
    });

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="85vh">
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <IconUsers size={15} />
          <h2 className="text-sm font-semibold text-text-primary">Members</h2>
          <span className="text-[11px] text-text-dim/50">{members.length} in the room</span>
        </div>
      </ModalHeader>
      <ModalBody className="p-5 space-y-3">
        {/* Active member — presets the learner for quizzes and the contributor
            for streams on this device. Unset = manual choice each time. */}
        {namedMembers.length > 0 && (
          <div className="rounded-lg border border-white/10 bg-white/2 px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1.5">
              <IconCheck size={13} className="text-violet-300" />
              <span className="text-[12px] font-medium text-text-primary">Active member</span>
              <span className="text-[10px] text-text-dim/60">presets learning quizzes &amp; streams</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {namedMembers.map((m) => {
                const active = m.id === activeMemberId;
                return (
                  <button
                    key={m.id}
                    onClick={() => setMemberId(m.id)}
                    className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                      active
                        ? 'border-violet-400/50 bg-violet-500/20 text-violet-200'
                        : 'border-white/10 text-text-dim hover:text-text-secondary hover:border-white/20'
                    }`}
                  >
                    {memberName(m)}
                    {m.role === 'gm' ? ' · GM' : ''}
                  </button>
                );
              })}
              {activeMemberId && (
                <button
                  onClick={() => setMemberId('')}
                  className="text-[10px] px-2 py-1 rounded-full text-text-dim/60 hover:text-text-secondary transition-colors"
                >
                  Clear (manual)
                </button>
              )}
            </div>
          </div>
        )}

        {members.length > 0 && (
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-white/5 text-[10px] uppercase tracking-wider text-text-dim/50">
                  <th className="text-left font-medium px-2.5 py-1.5 border-b border-r border-white/6 w-[27%]">First</th>
                  <th className="text-left font-medium px-2.5 py-1.5 border-b border-r border-white/6 w-[27%]">Last</th>
                  <th className="text-left font-medium px-2.5 py-1.5 border-b border-r border-white/6 w-[27%]">Mobile</th>
                  <th className="text-left font-medium px-2.5 py-1.5 border-b border-r border-white/6 w-[13%]">Role</th>
                  <th className="px-2.5 py-1.5 border-b border-white/6 w-[6%]" />
                </tr>
              </thead>
              <tbody>
                {members.map((p) => (
                  <tr key={p.id} className="border-b border-white/6 last:border-0 hover:bg-white/[0.02]">
                    <td className="border-r border-white/6">
                      <input
                        value={p.firstName}
                        onChange={(e) => patch(p, { firstName: e.target.value })}
                        placeholder="First"
                        className={cellInput}
                      />
                    </td>
                    <td className="border-r border-white/6">
                      <input
                        value={p.lastName}
                        onChange={(e) => patch(p, { lastName: e.target.value })}
                        placeholder="Last"
                        className={cellInput}
                      />
                    </td>
                    <td className="border-r border-white/6">
                      <input
                        value={p.mobile ?? ''}
                        onChange={(e) => patch(p, { mobile: e.target.value || undefined })}
                        placeholder="+mobile"
                        className={cellInput}
                      />
                    </td>
                    <td className="border-r border-white/6">
                      <select
                        value={p.role}
                        onChange={(e) => patch(p, { role: e.target.value as MemberRole })}
                        className={`${cellInput} cursor-pointer`}
                      >
                        {MEMBER_ROLES.map((r) => (
                          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="text-center">
                      <button
                        onClick={() => dispatch({ type: 'REMOVE_MEMBER', id: p.id })}
                        className="inline-flex justify-center text-text-dim/40 hover:text-red-400 transition-colors"
                        title="Remove member"
                      >
                        <IconTrash size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <button
          onClick={addMember}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-white/10 text-[12px] text-text-dim/60 hover:text-text-primary hover:border-white/20 hover:bg-white/[0.02] transition-colors"
        >
          <IconPlus size={13} />
          {members.length === 0 ? 'Add the GM (master device)' : 'Add member'}
        </button>
      </ModalBody>
    </Modal>
  );
}
