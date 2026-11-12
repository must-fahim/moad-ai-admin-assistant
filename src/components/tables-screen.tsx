"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { APP_PAGES } from "@/lib/catalog";
import type { AdvertiserRow, ApplicationRow, ClientLists, PartnerRow } from "@/lib/client-lists";
import { SkeletonTable } from "@/components/loader";
import { labelize } from "@/lib/labels";

export function TablesScreen({ lists }: { lists: ClientLists }) {
  const [origin, setOrigin] = useState("");
  const [data, setData] = useState(lists);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const reload = useCallback(async (board: string) => {
    setRefreshing(board);
    try {
      const response = await fetch("/api/records", { cache: "no-store" });
      const body = await response.json();
      if (response.ok) setData(body);
      else setData((current) => ({ ...current, error: body.error || "Could not refresh the records." }));
    } finally {
      setRefreshing(null);
    }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  return (
      <section className="stage">
        <header className="stage-bar">
          <div className="stage-title">
            <strong>Records</strong>
            <span>Advertisers, driving partners, applications, and the blacklist.</span>
          </div>
        </header>
        <div className="stage-scroll">
          <div className="guide-body client-page">
            {data.error ? <p className="guide-empty">{data.error}</p> : null}
            <AdvertiserBoard rows={data.advertisers} refreshing={refreshing === "advertisers" || refreshing === "page"} onRefresh={() => reload("advertisers")} />
            <PartnerBoard rows={data.partners} refreshing={refreshing === "partners" || refreshing === "page"} onRefresh={() => reload("partners")} />
            <ApplicationBoard rows={data.applications} refreshing={refreshing === "applications" || refreshing === "page"} onRefresh={() => reload("applications")} />
            <BlacklistBoard advertisers={data.advertisers} partners={data.partners} refreshing={refreshing === "blacklist" || refreshing === "page"} onRefresh={() => reload("blacklist")} />
            <section className="guide-section" id="urls">
              <div className="guide-section-head">
                <h2>Pages</h2>
                <p>Addresses for this assistant.</p>
              </div>
              <table className="catalog-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>URL</th>
                  </tr>
                </thead>
                <tbody>
                  {APP_PAGES.map((page) => {
                    const url = `${origin}${page.path}`;
                    return (
                      <tr key={page.path}>
                        <td>{page.name}</td>
                        <td>{origin ? <a href={url}>{url}</a> : page.path}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </div>
        </div>
      </section>
  );
}

function AdvertiserBoard({ rows, refreshing, onRefresh }: { rows: AdvertiserRow[]; refreshing: boolean; onRefresh: () => void }) {
  const [tab, setTab] = useState<"all" | "applicants">("all");
  const shown = useMemo(
    () => rows.filter((row) => tab === "all" || row.status === "pending_approval"),
    [rows, tab],
  );

  return (
    <section className="client-board">
      <BoardTitle title="Advertiser member management" refreshing={refreshing} onRefresh={onRefresh} />
      <div className="client-tabs">
        <button className={tab === "all" ? "on" : ""} type="button" onClick={() => setTab("all")}>View all</button>
        <button className={tab === "applicants" ? "on" : ""} type="button" onClick={() => setTab("applicants")}>Applicants</button>
      </div>
      <TableFrame refreshing={refreshing}>
        <table className="client-table">
          <thead>
            <tr>
              <th>NO</th>
              <th>Status</th>
              <th>Company name</th>
              <th>Email</th>
              <th>Company phone number</th>
              <th>Contact name</th>
              <th>Contact phone number</th>
              <th>Registration date</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? <Empty cols={8} /> : shown.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td><Status value={row.status} /></td>
                <td>{row.companyName}</td>
                <td>{row.email}</td>
                <td>{row.companyPhone}</td>
                <td>{row.contactName}</td>
                <td>{row.contactPhone}</td>
                <td>{row.registeredAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
    </section>
  );
}

function PartnerBoard({ rows, refreshing, onRefresh }: { rows: PartnerRow[]; refreshing: boolean; onRefresh: () => void }) {
  const [tab, setTab] = useState<"all" | "driving" | "general">("all");
  const shown = useMemo(() => rows.filter((row) => {
    const driving = row.vehicleType !== "—";
    if (tab === "driving") return driving;
    if (tab === "general") return !driving;
    return true;
  }), [rows, tab]);

  return (
    <section className="client-board">
      <BoardTitle title="Driving Partner Member Management" refreshing={refreshing} onRefresh={onRefresh} />
      <div className="client-tabs">
        <button className={tab === "all" ? "on" : ""} type="button" onClick={() => setTab("all")}>View All</button>
        <button className={tab === "driving" ? "on" : ""} type="button" onClick={() => setTab("driving")}>Driving Partner</button>
        <button className={tab === "general" ? "on" : ""} type="button" onClick={() => setTab("general")}>General Member</button>
      </div>
      <TableFrame refreshing={refreshing}>
        <table className="client-table">
          <thead>
            <tr>
              <th>NO</th>
              <th>Member Number</th>
              <th>Member Name</th>
              <th>Mobile Phone Number</th>
              <th>Vehicle Number</th>
              <th>Vehicle Type</th>
              <th>Fixed Operating Location</th>
              <th>Region</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? <Empty cols={8} /> : shown.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.memberNumber}</td>
                <td>{row.name}</td>
                <td>{row.phone}</td>
                <td>{row.vehicleNumber}</td>
                <td>{row.vehicleType}</td>
                <td>{yn(row.fixedLocation)}</td>
                <td>{row.region}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
    </section>
  );
}

function ApplicationBoard({ rows, refreshing, onRefresh }: { rows: ApplicationRow[]; refreshing: boolean; onRefresh: () => void }) {
  const [tab, setTab] = useState<"all" | "application">("all");
  const shown = useMemo(
    () => rows.filter((row) => tab === "all" || row.status === "under_review"),
    [rows, tab],
  );

  return (
    <section className="client-board">
      <BoardTitle title="Operating Partner Application Management" refreshing={refreshing} onRefresh={onRefresh} />
      <div className="client-tabs">
        <button className={tab === "all" ? "on" : ""} type="button" onClick={() => setTab("all")}>View all</button>
        <button className={tab === "application" ? "on" : ""} type="button" onClick={() => setTab("application")}>Application</button>
      </div>
      <TableFrame refreshing={refreshing}>
        <table className="client-table">
          <thead>
            <tr>
              <th>NO</th>
              <th>Status value</th>
              <th>Member number</th>
              <th>Member name</th>
              <th>Phone number</th>
              <th>Vehicle number</th>
              <th>Vehicle type</th>
              <th>Fixed operation area</th>
              <th>Region</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? <Empty cols={9} /> : shown.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td><Status value={row.status} /></td>
                <td>{row.memberNumber}</td>
                <td>{row.name}</td>
                <td>{row.phone}</td>
                <td>{row.vehicleNumber}</td>
                <td>{row.vehicleType}</td>
                <td>{yn(row.fixedLocation)}</td>
                <td>{row.region}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
    </section>
  );
}

function BlacklistBoard({ advertisers, partners, refreshing, onRefresh }: { advertisers: AdvertiserRow[]; partners: PartnerRow[]; refreshing: boolean; onRefresh: () => void }) {
  const [tab, setTab] = useState<"partner" | "advertiser">("partner");
  const shownPartners = partners.filter((row) => row.status === "blacklist");
  const shownAdvertisers = advertisers.filter((row) => row.status === "blacklist");

  return (
    <section className="client-board">
      <BoardTitle title="Blacklist" refreshing={refreshing} onRefresh={onRefresh} />
      <div className="client-tabs">
        <button className={tab === "partner" ? "on" : ""} type="button" onClick={() => setTab("partner")}>Driving Partner</button>
        <button className={tab === "advertiser" ? "on" : ""} type="button" onClick={() => setTab("advertiser")}>Advertiser</button>
      </div>
      <TableFrame refreshing={refreshing}>
        <table className="client-table">
          <thead>
            <tr>
              <th>NO</th>
              <th>Name</th>
              <th>ID</th>
              <th>Mobile Phone Number</th>
              <th>Registration Date & Time</th>
            </tr>
          </thead>
          <tbody>
            {tab === "partner" ? (
              shownPartners.length === 0 ? <Empty cols={5} /> : shownPartners.map((row, index) => (
                <tr key={row.id}>
                  <td>{index + 1}</td>
                  <td>{row.name}</td>
                  <td>{row.memberNumber}</td>
                  <td>{row.phone}</td>
                  <td>{row.registeredAt}</td>
                </tr>
              ))
            ) : shownAdvertisers.length === 0 ? <Empty cols={5} /> : shownAdvertisers.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.companyName}</td>
                <td>{row.email}</td>
                <td>{row.companyPhone}</td>
                <td>{row.registeredAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
    </section>
  );
}

function TableFrame({ refreshing, children }: { refreshing: boolean; children: React.ReactNode }) {
  return (
    <div className={`client-scroll${refreshing ? " is-loading" : ""}`} aria-busy={refreshing}>
      {refreshing ? <SkeletonTable /> : children}
    </div>
  );
}

function BoardTitle({ title, refreshing, onRefresh }: { title: string; refreshing: boolean; onRefresh: () => void }) {
  return (
    <div className="client-head">
      <h2>{title}</h2>
      <button className="client-refresh" type="button" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}

function Status({ value }: { value: string }) {
  return <span className={`status-pill ${value}`}>{labelize(value)}</span>;
}

function Empty({ cols }: { cols: number }) {
  return <tr><td className="client-empty" colSpan={cols}>No matching records</td></tr>;
}

function yn(value: boolean | null) {
  if (value == null) return "—";
  return value ? "Y" : "N";
}
