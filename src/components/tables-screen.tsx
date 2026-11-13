"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { APP_PAGES } from "@/lib/catalog";
import type { AdvertiserRow, AdvertiserSettlementRow, ApplicationRow, CampaignRow, CargoSettlementRow, ClientLists, FaqRow, NoticeRow, PartnerCampaignRow, PartnerRow, SoloRow } from "@/lib/client-lists";
import { SkeletonTable } from "@/components/loader";
import { labelize } from "@/lib/labels";

export function TablesScreen({ lists, origin }: { lists: ClientLists; origin: string }) {
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

  return (
      <section className="stage">
        <header className="stage-bar">
          <div className="stage-title">
            <strong>Records</strong>
            <span>Read-only lists from the admin screens. Refresh any list for the latest rows.</span>
          </div>
        </header>
        <div className="stage-scroll">
          <div className="guide-body client-page">
            {data.error ? <p className="guide-empty">{data.error}</p> : null}
            <AdvertiserBoard rows={data.advertisers} refreshing={refreshing === "advertisers" || refreshing === "page"} onRefresh={() => reload("advertisers")} />
            <PartnerBoard rows={data.partners} refreshing={refreshing === "partners" || refreshing === "page"} onRefresh={() => reload("partners")} />
            <ApplicationBoard rows={data.applications} refreshing={refreshing === "applications" || refreshing === "page"} onRefresh={() => reload("applications")} />
            <BlacklistBoard advertisers={data.advertisers} partners={data.partners} refreshing={refreshing === "blacklist" || refreshing === "page"} onRefresh={() => reload("blacklist")} />
            <CampaignBoard rows={data.campaigns} refreshing={refreshing === "campaigns" || refreshing === "page"} onRefresh={() => reload("campaigns")} />
            <PartnerCampaignBoard rows={data.partnerCampaigns} refreshing={refreshing === "partnerCampaigns" || refreshing === "page"} onRefresh={() => reload("partnerCampaigns")} />
            <ReportBoard rows={data.campaigns} refreshing={refreshing === "reports" || refreshing === "page"} onRefresh={() => reload("reports")} />
            <CargoSettlementBoard rows={data.cargoSettlements} refreshing={refreshing === "cargoSettlements" || refreshing === "page"} onRefresh={() => reload("cargoSettlements")} />
            <PayoutBoard rows={data.cargoSettlements} refreshing={refreshing === "payouts" || refreshing === "page"} onRefresh={() => reload("payouts")} />
            <AdvertiserSettlementBoard rows={data.advertiserSettlements} refreshing={refreshing === "advertiserSettlements" || refreshing === "page"} onRefresh={() => reload("advertiserSettlements")} />
            <SoloBoard rows={data.solo} refreshing={refreshing === "solo" || refreshing === "page"} onRefresh={() => reload("solo")} />
            <FaqBoard rows={data.faqs} refreshing={refreshing === "faqs" || refreshing === "page"} onRefresh={() => reload("faqs")} />
            <NoticeBoard rows={data.notices} refreshing={refreshing === "notices" || refreshing === "page"} onRefresh={() => reload("notices")} />
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
              <th>Registration Date & Time</th>
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
              <th>Registration Date & Time</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? <Empty cols={9} /> : shown.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.memberNumber}</td>
                <td>{row.name}</td>
                <td>{row.phone}</td>
                <td>{row.vehicleNumber}</td>
                <td>{row.vehicleType}</td>
                <td>{yn(row.fixedLocation)}</td>
                <td>{row.region}</td>
                <td>{row.registeredAt}</td>
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
              <th>Registration date</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? <Empty cols={10} /> : shown.map((row, index) => (
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
                <td>{row.registeredAt}</td>
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
              <th>Blacklist reason</th>
              <th>Registration Date & Time</th>
              <th>Blacklist registration date & time</th>
              <th>Administrator</th>
            </tr>
          </thead>
          <tbody>
            {tab === "partner" ? (
              shownPartners.length === 0 ? <Empty cols={8} /> : shownPartners.map((row, index) => (
                <tr key={row.id}>
                  <td>{index + 1}</td>
                  <td>{row.name}</td>
                  <td>{row.memberNumber}</td>
                  <td>{row.phone}</td>
                  <td>—</td>
                  <td>{row.registeredAt}</td>
                  <td>—</td>
                  <td>—</td>
                </tr>
              ))
            ) : shownAdvertisers.length === 0 ? <Empty cols={8} /> : shownAdvertisers.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.companyName}</td>
                <td>{row.email}</td>
                <td>{row.companyPhone}</td>
                <td>—</td>
                <td>{row.registeredAt}</td>
                <td>—</td>
                <td>—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
    </section>
  );
}

function CampaignBoard({ rows, refreshing, onRefresh }: { rows: CampaignRow[]; refreshing: boolean; onRefresh: () => void }) {
  return (
    <SimpleBoard
      title="Campaign management (advertisers)"
      refreshing={refreshing}
      onRefresh={onRefresh}
      headers={["NO.", "Status value", "Ad name", "Company name", "Ad period", "Contact person", "Contact phone number", "Vehicles in operation", "Driver recruitment status", "Campaign application date/time"]}
      rows={rows.map((row, index) => [
        index + 1,
        <Status key="s" value={row.status} />,
        row.name,
        row.companyName,
        row.period,
        row.contactName,
        row.contactPhone,
        row.vehicles,
        <Status key="r" value={row.recruitment} />,
        row.appliedAt,
      ])}
    />
  );
}

function PartnerCampaignBoard({ rows, refreshing, onRefresh }: { rows: PartnerCampaignRow[]; refreshing: boolean; onRefresh: () => void }) {
  return (
    <SimpleBoard
      title="Campaign management (operating partners)"
      refreshing={refreshing}
      onRefresh={onRefresh}
      headers={["NO.", "Status", "Member number", "Member name", "Phone number", "Vehicle number", "Vehicle type", "Ad name", "Ad period", "Region", "Applied at"]}
      rows={rows.map((row, index) => [
        index + 1,
        <Status key="s" value={row.status} />,
        row.memberNumber,
        row.name,
        row.phone,
        row.vehicleNumber,
        row.vehicleType,
        row.adName,
        row.period,
        row.region,
        row.appliedAt,
      ])}
    />
  );
}

function ReportBoard({ rows, refreshing, onRefresh }: { rows: CampaignRow[]; refreshing: boolean; onRefresh: () => void }) {
  return (
    <SimpleBoard
      title="Advertisement report management"
      refreshing={refreshing}
      onRefresh={onRefresh}
      headers={["NO.", "Status", "Campaign name", "Company name", "Campaign period", "Latest report", "Advertiser share"]}
      rows={rows.map((row, index) => [
        index + 1,
        <Status key="s" value={row.status} />,
        row.name,
        row.companyName,
        row.period,
        row.latestReport,
        "—",
      ])}
    />
  );
}

function CargoSettlementBoard({ rows, refreshing, onRefresh }: { rows: CargoSettlementRow[]; refreshing: boolean; onRefresh: () => void }) {
  return (
    <SimpleBoard
      title="Settlement (operating partners)"
      refreshing={refreshing}
      onRefresh={onRefresh}
      headers={["NO.", "Status", "Member number", "Name", "Contact", "Vehicle type", "Operation count", "Distance", "Final settlement amount", "Settlement month"]}
      rows={rows.map((row, index) => [
        index + 1,
        <Status key="s" value={row.status} />,
        row.memberNumber,
        row.name,
        row.contact,
        row.vehicleType,
        row.operationCount,
        row.distance,
        row.net,
        row.month,
      ])}
    />
  );
}

function PayoutBoard({ rows, refreshing, onRefresh }: { rows: CargoSettlementRow[]; refreshing: boolean; onRefresh: () => void }) {
  return (
    <SimpleBoard
      title="Settlement records (driving partners)"
      refreshing={refreshing}
      onRefresh={onRefresh}
      headers={["Member no.", "Name", "Distance", "Base", "Extras", "Tax", "Net", "Status", "Settlement month"]}
      rows={rows.map((row) => [
        row.memberNumber,
        row.name,
        row.distance,
        row.base,
        row.extras,
        row.tax,
        row.net,
        <Status key="s" value={row.status} />,
        row.month,
      ])}
    />
  );
}

function AdvertiserSettlementBoard({ rows, refreshing, onRefresh }: { rows: AdvertiserSettlementRow[]; refreshing: boolean; onRefresh: () => void }) {
  return (
    <SimpleBoard
      title="Settlement (advertisers)"
      refreshing={refreshing}
      onRefresh={onRefresh}
      headers={["NO.", "Status", "Company name", "Campaign name", "Ad period", "Type", "Discount rate", "Final payment amount", "Contact person", "Contact", "Campaign application date/time"]}
      rows={rows.map((row, index) => [
        index + 1,
        <Status key="s" value={row.status} />,
        row.companyName,
        row.campaignName,
        row.period,
        <Status key="t" value={row.type} />,
        row.discount,
        row.amount,
        row.contactName,
        row.contact,
        row.appliedAt,
      ])}
    />
  );
}

function SoloBoard({ rows, refreshing, onRefresh }: { rows: SoloRow[]; refreshing: boolean; onRefresh: () => void }) {
  return (
    <SimpleBoard
      title="Solo Pay"
      refreshing={refreshing}
      onRefresh={onRefresh}
      headers={["No.", "Company name", "ID", "Company phone", "Ongoing campaigns", "Solo Pay linked", "Moad money", "Contact person", "Contact phone", "Registered at"]}
      rows={rows.map((row, index) => [
        index + 1,
        row.companyName,
        row.email,
        row.companyPhone,
        row.ongoing,
        row.linked ? "Y" : "N",
        row.balance,
        row.contactName,
        row.contactPhone,
        row.registeredAt,
      ])}
    />
  );
}

function FaqBoard({ rows, refreshing, onRefresh }: { rows: FaqRow[]; refreshing: boolean; onRefresh: () => void }) {
  return (
    <SimpleBoard
      title="FAQ"
      refreshing={refreshing}
      onRefresh={onRefresh}
      headers={["NO.", "Category", "Question", "Exposure", "Registration Date", "Author"]}
      rows={rows.map((row, index) => [
        index + 1,
        <Status key="c" value={row.category} />,
        row.question,
        row.exposed ? "Y" : "N",
        row.registeredAt,
        row.author,
      ])}
    />
  );
}

function NoticeBoard({ rows, refreshing, onRefresh }: { rows: NoticeRow[]; refreshing: boolean; onRefresh: () => void }) {
  return (
    <SimpleBoard
      title="Notices"
      refreshing={refreshing}
      onRefresh={onRefresh}
      headers={["NO", "Category Type", "Post Title", "Registration Date", "Author"]}
      rows={rows.map((row, index) => [
        index + 1,
        <Status key="a" value={row.audience} />,
        row.title,
        row.registeredAt,
        row.author,
      ])}
    />
  );
}

function SimpleBoard({
  title,
  headers,
  rows,
  refreshing,
  onRefresh,
}: {
  title: string;
  headers: string[];
  rows: ReactNode[][];
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="client-board">
      <BoardTitle title={title} refreshing={refreshing} onRefresh={onRefresh} />
      <TableFrame refreshing={refreshing}>
        <table className="client-table">
          <thead>
            <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <Empty cols={headers.length} /> : rows.map((cells, index) => (
              <tr key={index}>{cells.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
    </section>
  );
}

function TableFrame({ refreshing, children }: { refreshing: boolean; children: ReactNode }) {
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
